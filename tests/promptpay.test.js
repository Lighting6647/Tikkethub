const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPayload, crc16 } = require('../js/promptpay.js');

test('CRC-16/CCITT-FALSE standard check value', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('mobile number payload with amount', () => {
  const p = buildPayload('081-234-5678', 6500);
  assert.ok(p.startsWith('000201010212'), 'dynamic QR header');
  assert.ok(p.includes('0016A000000677010111'), 'PromptPay AID');
  assert.ok(p.includes('01130066812345678'), 'phone converted to 0066 format');
  assert.ok(p.includes('5303764'), 'THB currency');
  assert.ok(p.includes('54076500.00'), 'amount tag');
  assert.ok(p.includes('5802TH'), 'country');
  const body = p.slice(0, -4);
  assert.ok(body.endsWith('6304'));
  assert.equal(p.slice(-4), crc16(body), 'CRC matches payload');
});

test('13-digit ID uses sub-tag 02', () => {
  const p = buildPayload('1234567890123', 100);
  assert.ok(p.includes('02131234567890123'));
});

test('static QR when amount omitted', () => {
  assert.ok(buildPayload('0812345678').startsWith('000201010211'));
});

test('rejects invalid input', () => {
  assert.throws(() => buildPayload('12345', 10));
  assert.throws(() => buildPayload('0812345678', 0));
  assert.throws(() => buildPayload('0812345678', -5));
});
