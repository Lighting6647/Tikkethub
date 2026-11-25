const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

// Fake SlipOK: no real provider call, no quota used.
const realFetch = globalThis.fetch;
let slipok = () => ({ status: 500, text: 'down' });
let calls = [];
globalThis.fetch = async (url, init) => {
  const host = new URL(String(url)).hostname;
  if (host === '127.0.0.1') return realFetch(url, init);
  if (host !== 'api.slipok.com') throw new Error('blocked ' + host);
  calls.push({ log: init.body.get('log'), amount: init.body.get('amount') });
  const r = slipok();
  if (r.throw) throw r.throw;
  return { status: r.status || 200, text: async () => r.text || JSON.stringify(r.json) };
};

const db = require('../backend/db');
const handler = require('../server');
const ok = (amount, transRef) => () => ({ json: { success: true, data: { success: true, amount, transRef } } });
const fail = (code, message) => () => ({ status: 400, json: { code, message } });
const png = () => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return 'data:image/png;base64,' + Buffer.concat([head, crypto.randomBytes(2000)]).toString('base64');
};

let base;
let server;
let ipSeq = 1;
async function post(path, body, ip) {
  const res = await realFetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip || `10.0.0.${ipSeq++}` },
    body: JSON.stringify(body)
  });
  return { http: res.status, ...(await res.json()) };
}
const precheck = (slipData, amount = 1500, ip) => post('/api/slips/precheck', { slipData, amount }, ip);
const order = (slipData, extra = {}) =>
  post('/api/orders', {
    title: 'SLIP TEST', date: 'D', venue: 'V', zone: 'Zone A', qty: 1, unitPrice: 1500, total: 1500, seats: [],
    holderName: 'ทดสอบ ระบบ', holderPhone: '0891234567', holderIdCard: '1100412345673', slipName: 's.png', slipData, ...extra
  });
const settle = () => new Promise((r) => setTimeout(r, 60));

test.before(async () => {
  db.setSetting('slip_verify_provider', 'slipok');
  db.setSetting('slip_verify_api_key', 'test-key');
  db.setSetting('slip_verify_branch_id', '1');
  db.setSetting('slip_auto_approve_enabled', 'true');
  db.setSetting('line_channel_access_token', '');
  db.saveEvent({ title: 'SLIP TEST', venue: 'V', date: 'D', priceA: 1500, quotaVip: 1, quotaA: 100, quotaB: 1, quotaC: 1 });
  db.saveEvent({ title: 'SOLD OUT TEST', venue: 'V', date: 'D', priceA: 1500, quotaVip: 1, quotaA: 1, quotaB: 1, quotaC: 1 });
  assert.equal(db.computeOrderPrice({ title: 'SLIP TEST', zone: 'Zone A', qty: 1 }).total, 1500);
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.closeAllConnections();
  server.close();
  setTimeout(() => process.exit(), 50).unref();
});
test.beforeEach(() => { calls = []; });

test('picture without a bank QR is refused at attach and at submit, with one provider call', async () => {
  slipok = fail(1007, 'รูปภาพไม่มี QR Code');
  const img = png();
  const pre = await precheck(img);
  assert.equal(pre.status, 'failed');
  assert.equal(pre.code, 'NOT_A_SLIP');
  const o = await order(img);
  assert.equal(o.ok, false);
  assert.equal(o.code, 'SLIP_REJECTED');
  assert.equal(calls.length, 1);
});

test('real slip: passed, auto-approved, attach + submit cost one call that does not mark the slip used', async () => {
  slipok = ok(1500, 'TRANS-REAL-001');
  const img = png();
  assert.equal((await precheck(img)).status, 'passed');
  const o = await order(img, { slipCheckStatus: 'failed' });
  assert.equal(o.ok, true);
  await settle();
  const saved = db.getOrder(o.order.ref);
  assert.equal(saved.slipCheckStatus, 'passed');
  assert.equal(saved.status, 'approved');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].log, 'false');
});

test('re-saved copy of a used slip (same transaction) is refused', async () => {
  slipok = ok(1500, 'TRANS-REAL-001');
  const img = png();
  assert.equal((await precheck(img)).code, 'DUPLICATE');
  assert.equal((await order(img)).code, 'DUPLICATE_SLIP');
});

test('two simultaneous orders with copies of one slip: only one succeeds', async () => {
  slipok = ok(1500, 'TRANS-RACE-002');
  const res = await Promise.all([order(png()), order(png())]);
  assert.equal(res.filter((r) => r.ok).length, 1);
});

test('transaction reference kept only in verification_detail (older orders) still counts as used', async () => {
  const old = db.createOrder({ title: 'SLIP TEST', date: 'D', venue: 'V', zone: 'Zone A', qty: 1, unitPrice: 1, total: 1, holderName: 'a b', holderPhone: '1', slipData: png() });
  db.updateOrderDriveAndVerification(old.ref, { verifiedBy: 'SlipOK API', verificationDetail: 'รหัสอ้างอิง: TRANS-OLD-003 (ยอด)' });
  slipok = ok(1500, 'TRANS-OLD-003');
  assert.equal((await order(png())).code, 'DUPLICATE_SLIP');
});

test('wrong amount: order is kept, marked failed and never auto-approved', async () => {
  slipok = ok(100, 'TRANS-LOW-004');
  const img = png();
  assert.equal((await precheck(img)).code, 'AMOUNT_MISMATCH');
  const o = await order(img);
  await settle();
  assert.equal(o.ok, true);
  const saved = db.getOrder(o.order.ref);
  assert.equal(saved.slipCheckStatus, 'failed');
  assert.equal(saved.status, 'pending');
});

test('provider down / quota / timeout: customer can still order, unchecked and not approved', async () => {
  for (const reply of [() => ({ throw: new Error('net') }), fail(1004, 'quota'), () => ({ status: 502, text: '<html>' }), fail(1010, 'bank delay')]) {
    slipok = reply;
    const img = png();
    assert.equal((await precheck(img)).status, 'unchecked');
    const o = await order(img);
    await settle();
    const saved = db.getOrder(o.order.ref);
    assert.equal(saved.slipCheckStatus, 'unchecked');
    assert.equal(saved.status, 'pending');
  }
});

test('simulator never shows as passed and never issues tickets', async () => {
  db.setSetting('slip_verify_provider', 'simulator');
  const o = await order(png());
  await settle();
  const saved = db.getOrder(o.order.ref);
  db.setSetting('slip_verify_provider', 'slipok');
  assert.equal(saved.slipCheckStatus, 'unchecked');
  assert.equal(saved.status, 'pending');
});

test('verdict is bound to the amount: a pass for 1500 is not reused for a 3000 order', async () => {
  slipok = ok(1500, 'TRANS-AMT-005');
  const img = png();
  assert.equal((await precheck(img, 1500)).status, 'passed');
  const o = await order(img, { qty: 2 });
  assert.equal(db.getOrder(o.order.ref).slipCheckStatus, 'failed');
});

test('slip of a rejected order may be sent again, but only a person can approve it', async () => {
  const img = png();
  slipok = ok(1500, 'TRANS-REJ-006');
  const first = await order(img);
  await settle();
  db.updateOrderStatus(first.order.ref, { status: 'rejected', rejectReason: 'x' });
  const again = await order(img);
  await settle();
  assert.equal(again.ok, true);
  const saved = db.getOrder(again.order.ref);
  assert.equal(saved.slipCheckStatus, 'unchecked');
  assert.equal(saved.status, 'pending');
  assert.match(saved.verificationDetail, new RegExp(first.order.ref));
});

test('sold-out order waiting for a refund: its slip cannot buy another ticket automatically', async () => {
  slipok = ok(1500, 'TRANS-REFUND-007');
  slipok = ok(1500, 'TRANS-LAST-SEAT');
  assert.equal((await order(png(), { title: 'SOLD OUT TEST' })).ok, true);
  slipok = ok(1500, 'TRANS-REFUND-007');
  const sold = await order(png(), { title: 'SOLD OUT TEST' });
  assert.equal(sold.code, 'SOLD_OUT');
  const again = await order(png());
  await settle();
  const saved = db.getOrder(again.order.ref);
  assert.equal(saved.slipCheckStatus, 'unchecked');
  assert.equal(saved.status, 'pending');
  assert.equal((await order(png())).code, 'DUPLICATE_SLIP');
});

test('price typed in the browser is ignored: the slip must match the server price', async () => {
  slipok = ok(1, 'TRANS-CHEAP-008');
  const o = await order(png(), { total: 1, unitPrice: 1 });
  await settle();
  assert.equal(db.getOrder(o.order.ref).slipCheckStatus, 'failed');
  assert.equal(db.getOrder(o.order.ref).status, 'pending');
});

test('not an image is refused without using quota; pre-check is rate limited without blocking', async () => {
  const fake = 'data:image/png;base64,' + Buffer.alloc(2000, 65).toString('base64');
  assert.equal((await order(fake)).code, 'SLIP_REJECTED');
  assert.equal((await precheck(fake)).code, 'NOT_A_SLIP');
  assert.equal(calls.length, 0);
  slipok = fail(1007, 'no qr');
  let last;
  for (let i = 0; i < 6; i++) last = await precheck(png(), 1500, '10.9.9.9');
  assert.equal(last.status, 'unchecked');
  assert.equal(calls.length, 5);
});
