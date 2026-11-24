const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { buildPromptPayQrPng, crc32 } = require('../backend/qr-png');

test('crc32 matches the PNG reference value', () => {
  assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082);
});

test('builds a valid grayscale PNG of the PromptPay QR', () => {
  const png = buildPromptPayQrPng('0812345678', 1500);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, height);
  assert.ok(width >= 290, 'QR image is large enough for bank apps to scan');
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT');
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (width + 1) * height);
  // quiet zone: first row is all white, and the image contains dark modules
  assert.ok(raw.subarray(1, width + 1).every((b) => b === 0xff));
  assert.ok(raw.includes(0x00));
});

test('rejects a non-positive amount', () => {
  assert.throws(() => buildPromptPayQrPng('0812345678', 0));
});
