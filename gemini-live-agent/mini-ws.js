/**
 * Lightweight Zero-Dependency WebSocket Server (RFC 6455)
 * Enables real-time browser-to-server streaming without external npm packages.
 */

const crypto = require('node:crypto');
const EventEmitter = require('node:events');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class SimpleWsClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.isOpen = true;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => {
      if (this.isOpen) {
        this.isOpen = false;
        this.emit('close');
      }
    });
    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  send(data) {
    if (!this.isOpen || this.socket.destroyed) return;
    const isBuffer = Buffer.isBuffer(data);
    const payload = isBuffer ? data : Buffer.from(data, 'utf8');
    const opcode = isBuffer ? 0x02 : 0x01; // binary or text
    const len = payload.length;

    let header;
    if (len <= 125) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    this.socket.write(Buffer.concat([header, payload]));
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    try {
      this.socket.write(Buffer.from([0x88, 0x00])); // close frame
      this.socket.end();
    } catch (e) {}
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      const isMasked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) return;

      const payload = this.buffer.subarray(offset, offset + payloadLen);
      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x08) {
        // Connection close
        this.close();
        this.emit('close');
        return;
      } else if (opcode === 0x09) {
        // Ping -> reply Pong
        if (this.isOpen) this.socket.write(Buffer.from([0x8a, 0x00]));
      } else if (opcode === 0x01) {
        // Text message
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x02) {
        // Binary message
        this.emit('message', payload);
      }
    }
  }
}

function attachWebSocketServer(httpServer, onConnection) {
  httpServer.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const client = new SimpleWsClient(socket);
    onConnection(client, req);
  });
}

module.exports = {
  attachWebSocketServer
};
