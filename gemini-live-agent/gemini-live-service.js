/**
 * Gemini Live API Service
 * Handles bidirectional WebSocket streaming with Gemini 3.8 Live models,
 * non-blocking function calling, conversational fillers, and interruption handling.
 */

const { TOOL_DECLARATIONS, executeTool } = require('./tools');

const GEMINI_LIVE_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

class GeminiLiveSession {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - Gemini API key
   * @param {string} [options.model] - 'gemini-3.8-live' or 'gemini-3.8-live-extended-thinking'
   * @param {string} [options.voiceName] - 'Puck', 'Aoede', 'Charon', 'Fenrir', 'Kore'
   * @param {string} [options.thinkingLevel] - 'low', 'medium', 'high'
   * @param {Function} options.onAudioChunk - callback(base64Pcm24k)
   * @param {Function} options.onInputTranscript - callback(text)
   * @param {Function} options.onOutputTranscript - callback(text)
   * @param {Function} options.onToolCall - callback(toolCallInfo)
   * @param {Function} options.onToolResponse - callback(toolResponseInfo)
   * @param {Function} options.onInterrupted - callback()
   * @param {Function} options.onStatusChange - callback('IDLE'|'IN_PROGRESS')
   * @param {Function} options.onError - callback(error)
   * @param {Function} options.onClose - callback()
   */
  constructor(options) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for Gemini Live API.');
    }

    this.model = options.model || 'gemini-3.8-live-extended-thinking';
    this.voiceName = options.voiceName || 'Aoede';
    this.thinkingLevel = options.thinkingLevel || 'low';

    this.onAudioChunk = options.onAudioChunk || (() => {});
    this.onInputTranscript = options.onInputTranscript || (() => {});
    this.onOutputTranscript = options.onOutputTranscript || (() => {});
    this.onToolCall = options.onToolCall || (() => {});
    this.onToolResponse = options.onToolResponse || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onClose = options.onClose || (() => {});

    this.ws = null;
    this.isConnected = false;
    this.activeToolTasks = new Set();
  }

  /**
   * Establish WebSocket connection and transmit BidiGenerateContentSetup
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const url = `${GEMINI_LIVE_WS_BASE}?key=${this.apiKey}`;
      console.log(`[GeminiLive] Connecting to ${url.replace(/key=([^&]+)/, 'key=***')} (Model: ${this.model})...`);

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        return reject(err);
      }

      this.ws.onopen = () => {
        console.log('[GeminiLive] WebSocket connected! Sending setup configuration...');
        this.isConnected = true;
        this._sendSetupConfig();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const message = JSON.parse(raw);
          this._handleServerMessage(message);
        } catch (err) {
          console.error('[GeminiLive] Failed parsing server message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[GeminiLive] WebSocket error:', error);
        this.onError(error);
        if (!this.isConnected) reject(error);
      };

      this.ws.onclose = (event) => {
        console.log(`[GeminiLive] WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        this.isConnected = false;
        this.onClose();
      };
    });
  }

  /**
   * Send the initial BidiGenerateContentSetup message
   */
  _sendSetupConfig() {
    const isExtendedThinking = this.model.includes('extended-thinking');

    const setupPayload = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voiceName
              }
            }
          },
          ...(isExtendedThinking
            ? {
                thinkingConfig: {
                  thinkingLevel: this.thinkingLevel
                }
              }
            : {})
        },
        systemInstruction: {
          parts: [
            {
              text: `You are the official ThaiTicketHub AI Voice Concierge.
You provide low-latency, real-time voice assistance for concerts, ticketing, seating zones, pricing calculations, and order lookups.

NON-BLOCKING FUNCTION CALLING BEHAVIOR:
- All tools are configured with behavior: "NON_BLOCKING".
- When an inquiry requires tool execution (checking availability, booking quotes, or order status), ALWAYS immediately speak conversational fillers (e.g. "Let me check the remaining seats in Zone A for you...", "Calculating the total with promo code now...") while the tool runs in the background.
- Do NOT pause or say nothing while waiting for tool responses. Keep speech natural, polite, and engaging.
- When the tool response arrives, seamlessly integrate the factual information into your speech.
- If the user interrupts you, stop immediately and listen.
- Keep answers concise and optimized for spoken audio conversation (avoid reading markdown asterisks or bullet points).`
            }
          ]
        },
        tools: [
          {
            functionDeclarations: TOOL_DECLARATIONS
          }
        ],
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      }
    };

    this._send(setupPayload);
  }

  /**
   * Parse incoming messages from the Gemini Live server
   */
  _handleServerMessage(message) {
    // 1. Process server content (audio chunks, transcripts, interruption signal)
    if (message.serverContent) {
      const content = message.serverContent;

      // Handle user interruption
      if (content.interrupted === true) {
        console.log('[GeminiLive] ⚡ Interruption detected! User barge-in.');
        this.onInterrupted();
      }

      // Handle audio stream parts
      if (content.modelTurn && Array.isArray(content.modelTurn.parts)) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData && part.inlineData.data) {
            this.onAudioChunk(part.inlineData.data);
          }
        }
      }

      // Handle live audio transcripts
      if (content.inputTranscription && content.inputTranscription.text) {
        this.onInputTranscript(content.inputTranscription.text);
      }
      if (content.outputTranscription && content.outputTranscription.text) {
        this.onOutputTranscript(content.outputTranscription.text);
      }
    }

    // 2. Process Asynchronous Non-blocking Tool Calls
    if (message.toolCall && Array.isArray(message.toolCall.functionCalls)) {
      for (const call of message.toolCall.functionCalls) {
        this._dispatchNonBlockingTool(call);
      }
    }

    // 3. Monitor Interaction Status (Gemini 3.8 Live Extended Thinking)
    const interactionStatus = message.interactionStatus || (message.serverContent && message.serverContent.interactionStatus);
    if (interactionStatus) {
      console.log(`[GeminiLive] Interaction status: ${interactionStatus}`);
      this.onStatusChange(interactionStatus);
    }
  }

  /**
   * Execute tool asynchronously without blocking incoming audio stream or server turns
   */
  async _dispatchNonBlockingTool(call) {
    const callId = call.id;
    const name = call.name;
    const args = call.args || {};

    console.log(`[GeminiLive] 🛠️ Non-blocking tool received: ${name} (id: ${callId})`);
    this.onToolCall({ id: callId, name, args, status: 'EXECUTING_ASYNC' });

    // Track active task
    this.activeToolTasks.add(callId);

    try {
      // Run tool asynchronously (does not block audio playback loop)
      const executionResult = await executeTool(name, args);

      // Format response according to Gemini Live API protocol
      const toolResponsePayload = {
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              name: name,
              response: executionResult.result
            }
          ]
        }
      };

      this._send(toolResponsePayload);
      console.log(`[GeminiLive] 📤 Sent tool response for ${name} (id: ${callId})`);

      this.onToolResponse({
        id: callId,
        name,
        result: executionResult.result,
        executionTimeMs: executionResult.execution_time_ms
      });
    } catch (err) {
      console.error(`[GeminiLive] Error in async tool ${name}:`, err);
      const errorPayload = {
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              name: name,
              response: { error: err.message || 'Execution error' }
            }
          ]
        }
      };
      this._send(errorPayload);
    } finally {
      this.activeToolTasks.delete(callId);
    }
  }

  /**
   * Send realtime audio input (PCM 16-bit 16kHz mono)
   * @param {string|Buffer} base64Audio
   */
  sendRealtimeAudio(base64Audio) {
    if (!this.isConnected) return;
    const data = typeof base64Audio === 'string' ? base64Audio : base64Audio.toString('base64');
    const payload = {
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: data
        }
      }
    };
    this._send(payload);
  }

  /**
   * Send realtime text message (e.g. user typed input or quick command)
   * @param {string} text
   */
  sendRealtimeText(text) {
    if (!this.isConnected) return;
    const payload = {
      realtimeInput: {
        text: text
      }
    };
    this._send(payload);
  }

  /**
   * Signal Hybrid VAD end-of-speech (client-detected silence)
   */
  sendAudioStreamEnd() {
    if (!this.isConnected) return;
    const payload = {
      realtimeInput: {
        audioStreamEnd: true
      }
    };
    this._send(payload);
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
      this.isConnected = false;
    }
  }
}

module.exports = {
  GeminiLiveSession
};
