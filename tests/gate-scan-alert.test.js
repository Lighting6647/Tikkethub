const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildTicketFlexMessage } = require('../backend/line');

test('LINE Flex Message contains scannable QR Code and ticket pass link', () => {
  const order = {
    ref: 'TT-TEST-9999',
    title: 'ECHOES OF ASIA WORLD TOUR 2026',
    date: '14 - 15 พ.ย. 2026',
    venue: 'อิมแพ็ค อารีน่า เมืองทองธานี',
    zone: 'VIP Standing',
    qty: 2,
    total: 13000,
    holderName: 'คุณสมชาย วงศ์สวัสดิ์',
    holderPhone: '081-234-5678',
    qrSignature: 'SIG9999ABCD'
  };

  const flex = buildTicketFlexMessage(order);
  assert.ok(flex, 'Flex message should be built');
  assert.equal(flex.type, 'flex');

  // Verify bubble body has QR image
  const bodyContents = flex.contents.body.contents;
  const qrBox = bodyContents.find((c) => c.type === 'box' && c.contents && c.contents.some((sub) => sub.type === 'image'));
  assert.ok(qrBox, 'Flex message body must contain QR image container');

  const qrImage = qrBox.contents.find((c) => c.type === 'image');
  assert.ok(qrImage, 'Must have QR image element');
  assert.ok(qrImage.url.includes('api.qrserver.com'), 'QR image URL points to QR generator');
  assert.ok(qrImage.url.includes('TT-TEST-9999'), 'QR image contains booking ref');

  // Verify footer has direct link to ticket pass
  assert.ok(flex.contents.footer, 'Flex message must contain footer');
  const passBtn = flex.contents.footer.contents[0];
  assert.ok(passBtn.action.uri.includes('ticket.html?ref=TT-TEST-9999'), 'Footer button points to ticket.html');
});

test('admin.html has jsQR library and Live Scanner HUD Overlay', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.includes('js/vendor/jsQR.js'), 'admin.html must load jsQR for iOS Safari');
  assert.ok(html.includes('id="scannerHudAlert"'), 'admin.html must contain live HUD alert container');
  assert.ok(html.includes('id="hudAlertCard"'), 'admin.html must contain HUD alert card');
  assert.ok(html.includes('วิธีสแกน:'), 'admin.html must show scan instructions');
  assert.ok(html.includes('id="gateSoundPackSelect"'), 'admin.html must have sound pack selector');
  assert.ok(html.includes('convenience'), 'Sound pack must offer 7-Eleven beep');
  assert.ok(html.includes('victory'), 'Sound pack must offer Victory chime');
  assert.ok(html.includes('cyber'), 'Sound pack must offer Cyber laser');
});

test('ticket.html exists and contains live security pass and QR frame', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ticket.html'), 'utf8');
  assert.ok(html.includes('LIVE DYNAMIC PASS'), 'ticket.html must feature live dynamic pass');
  assert.ok(html.includes('id="ticketQrElement"'), 'ticket.html must have QR element');
  assert.ok(html.includes('LINE Official Account'), 'ticket.html must cite LINE OA policy');
});

test('index.html storefront navbar has clean LINE OA link without public cart badge', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('class="btn-line-oa"'), 'Navbar has official LINE OA button');
  assert.ok(html.includes('id="lineOaNavLink"'), 'Navbar has lineOaNavLink');
  assert.ok(html.includes('id="cartButton"'), 'cartButton preserved in footer for test compatibility');
});

test('Feature 1 (Security): Ticket Re-entry Lockout tracks attempts and records incident details', () => {
  const db = require('../backend/db');
  db.clearAllForTest();
  const order = db.createOrder({
    title: 'RE-ENTRY SECURITY TOUR 2026',
    date: '2026-11-20',
    venue: 'Impact Hall 1',
    zone: 'VIP',
    qty: 1,
    unitPrice: 6500,
    total: 6500,
    holderName: 'คุณสมศักดิ์ ทดสอบเข้าซ้ำ',
    holderPhone: '081-999-8888',
    holderIdCard: '1-1004-12345-67-3',
    seats: ['VIP-09'],
    slipName: 'slip-reentry.png',
    slipMime: 'image/png',
    slipData: 'data:image/png;base64,' + Buffer.from('test_slip_reentry_1234567890'.padEnd(600, 'Z')).toString('base64')
  });

  db.updateOrderStatus(order.ref, { status: 'approved' });

  // 1st scan: must succeed
  const res1 = db.checkInOrder(order.ref, 'ประตู Gate A (Main)');
  assert.equal(res1.ok, true, '1st scan must pass');
  assert.equal(res1.code, 'CHECKED_IN');

  // 2nd scan: must block re-entry with ALREADY_CHECKED_IN
  const res2 = db.checkInOrder(order.ref, 'ประตู Gate B (Side)');
  assert.equal(res2.ok, false, '2nd scan must be blocked');
  assert.equal(res2.code, 'ALREADY_CHECKED_IN');
  assert.equal(res2.reEntryAttempts, 1, '1st duplicate attempt recorded');
  assert.ok(res2.firstCheckedInAt > 0, 'firstCheckedInAt is populated');
  assert.equal(res2.firstCheckedInBy, 'ประตู Gate A (Main)', 'firstCheckedInBy is preserved');

  // 3rd scan: attempt counter increments
  const res3 = db.checkInOrder(order.ref, 'ประตู VIP Fast Track');
  assert.equal(res3.ok, false);
  assert.equal(res3.reEntryAttempts, 2, '2nd duplicate attempt recorded');
});

test('Feature 2 & 3 (UX & Data): Fast-Scan mode, Torch, Turnstile & Attendance CSV export elements exist', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.includes('id="btnToggleFastScan"'), 'admin.html must contain Fast-Scan toggle button');
  assert.ok(html.includes('id="btnToggleTorch"'), 'admin.html must contain camera torch button');
  assert.ok(html.includes('id="btnOpenTurnstileFromScanner"'), 'admin.html must contain Turnstile button in scanner');
  assert.ok(html.includes('id="btnExportAttendanceCsv"'), 'admin.html must contain attendance CSV export button');
  assert.ok(html.includes('id="hudReEntryBox"'), 'admin.html must contain hudReEntryBox for lockout details');

  // Customer UI cleanup assertion: customer pending view must not expose admin link
  const viewerJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'ticket-viewer.js'), 'utf8');
  assert.ok(!viewerJs.includes('href="admin.html"'), 'Customer ticket view must NOT link to admin.html');
});

