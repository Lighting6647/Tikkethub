/**
 * Gemini Live Voice Agent Server
 * Standalone server with zero external npm dependencies.
 * Hosts Web Voice Dashboard and bridges bidirectional audio streaming to Gemini 3.8 Live API.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { attachWebSocketServer } = require('./mini-ws');
const { GeminiLiveSession } = require('./gemini-live-service');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// HTTP Server for Dashboard assets
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsedUrl.pathname;
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File Not Found');
    }

    let contentType = 'text/html';
    if (filePath.endsWith('.js')) contentType = 'application/javascript';
    else if (filePath.endsWith('.css')) contentType = 'text/css';
    else if (filePath.endsWith('.json')) contentType = 'application/json';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// Attach WebSocket Server
attachWebSocketServer(server, (clientWs, req) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws/agent') {
    clientWs.close();
    return;
  }

  console.log('\n[Voice Agent] 🎙️ Client connected to voice socket.');
  let geminiSession = null;

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'setup') {
        const apiKey = msg.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          clientWs.send(JSON.stringify({
            type: 'error',
            message: 'GEMINI_API_KEY not found. Please provide an API key in the UI or set GEMINI_API_KEY environment variable.'
          }));
          return;
        }

        if (geminiSession) {
          geminiSession.close();
        }

        console.log(`[Voice Agent] Initializing Gemini Live Session (Model: ${msg.model || 'gemini-3.8-live-extended-thinking'})...`);

        geminiSession = new GeminiLiveSession({
          apiKey,
          model: msg.model || 'gemini-3.8-live-extended-thinking',
          voiceName: msg.voiceName || 'Aoede',
          thinkingLevel: msg.thinkingLevel || 'low',

          onAudioChunk: (base64Audio) => {
            clientWs.send(JSON.stringify({ type: 'audio', data: base64Audio }));
          },
          onInputTranscript: (text) => {
            console.log(`[Transcript User] "${text}"`);
            clientWs.send(JSON.stringify({ type: 'input_transcript', text }));
          },
          onOutputTranscript: (text) => {
            console.log(`[Transcript Concierge] "${text}"`);
            clientWs.send(JSON.stringify({ type: 'output_transcript', text }));
          },
          onToolCall: (callInfo) => {
            console.log(`[Voice Agent Tool Call] ${callInfo.name}:`, callInfo.args);
            clientWs.send(JSON.stringify({
              type: 'tool_call',
              id: callInfo.id,
              name: callInfo.name,
              args: callInfo.args
            }));
          },
          onToolResponse: (respInfo) => {
            console.log(`[Voice Agent Tool Response] ${respInfo.name} in ${respInfo.executionTimeMs}ms`);
            clientWs.send(JSON.stringify({
              type: 'tool_response',
              id: respInfo.id,
              name: respInfo.name,
              result: respInfo.result,
              executionTimeMs: respInfo.executionTimeMs
            }));
          },
          onInterrupted: () => {
            console.log('[Voice Agent] ⚡ User interrupted agent! Flushing audio buffer.');
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          },
          onStatusChange: (status) => {
            clientWs.send(JSON.stringify({ type: 'status', status }));
          },
          onError: (err) => {
            clientWs.send(JSON.stringify({ type: 'error', message: err.message || 'Gemini error' }));
          },
          onClose: () => {
            clientWs.send(JSON.stringify({ type: 'status', status: 'CLOSED' }));
          }
        });

        try {
          await geminiSession.connect();
          clientWs.send(JSON.stringify({ type: 'status', status: 'IDLE' }));
        } catch (err) {
          console.error('[Voice Agent] Connection error:', err.message);
          clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to Gemini Live: ' + err.message }));
        }

      } else if (msg.type === 'audio') {
        if (geminiSession && geminiSession.isConnected) {
          geminiSession.sendRealtimeAudio(msg.data);
        }
      } else if (msg.type === 'text') {
        if (geminiSession && geminiSession.isConnected) {
          geminiSession.sendRealtimeText(msg.text);
        }
      } else if (msg.type === 'audio_stream_end') {
        if (geminiSession && geminiSession.isConnected) {
          geminiSession.sendAudioStreamEnd();
        }
      }
    } catch (err) {
      console.error('[Voice Agent] Error handling client message:', err);
    }
  });

  clientWs.on('close', () => {
    console.log('[Voice Agent] Client disconnected.');
    if (geminiSession) {
      geminiSession.close();
      geminiSession = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`
=================================================================
🎧 Gemini Live Real-Time Voice Agent Server Running
=================================================================
🌐 Dashboard URL: http://localhost:${PORT}
⚡ WebSocket Endpoint: ws://localhost:${PORT}/ws/agent
🤖 Models: gemini-3.8-live-extended-thinking | gemini-3.8-live
🛠️ Tools: check_ticket_availability, calculate_booking_quote, lookup_reservation_status
✨ Protocol: behavior="NON_BLOCKING" (Async tools with spoken fillers)
=================================================================
`);
});
