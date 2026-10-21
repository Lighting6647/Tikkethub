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
});

test('ticket.html exists and contains live security pass and QR frame', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ticket.html'), 'utf8');
  assert.ok(html.includes('LIVE DYNAMIC PASS'), 'ticket.html must feature live dynamic pass');
  assert.ok(html.includes('id="ticketQrElement"'), 'ticket.html must have QR element');
  assert.ok(html.includes('LINE Official Account'), 'ticket.html must cite LINE OA policy');
});
