/**
 * Server-side PromptPay QR -> real PNG file (no external deps).
 * Used so customers inside LINE / in-app browsers can long-press a real image URL
 * (or open it in Safari/Chrome) to save the QR, since blob/data URLs, download links
 * and navigator.share are unreliable there.
 */
const zlib = require('node:zlib');
const path = require('node:path');
const qrcode = require(path.join(__dirname, '..', 'js', 'vendor', 'qrcode.js'));
const PromptPay = require(path.join(__dirname, '..', 'js', 'promptpay.js'));

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode a boolean module matrix as an 8-bit grayscale PNG. */
function matrixToPng(isDark, count, scale = 10, marginModules = 4) {
  const size = (count + marginModules * 2) * scale;
  const raw = Buffer.alloc((size + 1) * size, 0xff);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size + 1);
    raw[rowStart] = 0; // filter: none
    const my = Math.floor(y / scale) - marginModules;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - marginModules;
      if (my >= 0 && my < count && mx >= 0 && mx < count && isDark(my, mx)) raw[rowStart + 1 + x] = 0x00;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Returns a PNG Buffer of the PromptPay QR for the given target + amount. */
function buildPromptPayQrPng(promptpayId, amount) {
  const payload = PromptPay.buildPayload(promptpayId, amount);
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  return matrixToPng((r, c) => qr.isDark(r, c), count);
}

module.exports = { buildPromptPayQrPng, matrixToPng, crc32 };
