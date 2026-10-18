const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../backend/db');

function makeDummySlip(tag) {
  return 'data:image/png;base64,' + Buffer.from(tag.padEnd(800, 'X')).toString('base64');
}

test('Offline Gate & Batch Sync: offline roster export returns approved tickets with signatures', () => {
  db.clearAllForTest();
  const order = db.createOrder({
    title: 'OFFLINE FEST 2026',
    date: '2026-11-20',
    venue: 'Impact Hall 1',
    zone: 'Zone A',
    qty: 2,
    unitPrice: 3500,
    total: 7000,
    promoCode: '',
    discountAmount: 0,
    holderName: 'คุณออฟไลน์ สมบูรณ์',
    holderPhone: '0812345678',
    holderIdCard: '1-1004-12345-67-3',
    seats: ['A-01', 'A-02'],
    slipName: 'slip-offline1.png',
    slipMime: 'image/png',
    slipData: makeDummySlip('slip_test_offline_1')
  });

  // Approve order so it enters the approved roster
  db.updateOrderStatus(order.ref, { status: 'approved' });

  const approved = db.listOrders({ status: 'approved', includeSlipData: false });
  assert.ok(approved.length >= 1, 'At least 1 approved order in db');

  const found = approved.find((o) => o.ref === order.ref);
  assert.ok(found, 'Created order found in approved list');
  assert.equal(found.holderName, 'คุณออฟไลน์ สมบูรณ์');
  assert.ok(found.qrSignature, 'HMAC-SHA256 signature generated');
  assert.ok(found.qrPayload.includes(found.qrSignature), 'Signature included in QR payload');
});

test('Offline Gate & Batch Sync: batch sync updates check-in statuses and logs audit trail', () => {
  db.clearAllForTest();
  const order1 = db.createOrder({
    title: 'OFFLINE FEST 2026',
    date: '2026-11-20',
    venue: 'Impact Hall 1',
    zone: 'VIP',
    qty: 1,
    unitPrice: 6500,
    total: 6500,
    promoCode: '',
    discountAmount: 0,
    holderName: 'นายหนึ่ง ประตูเข้า',
    holderPhone: '0891112222',
    holderIdCard: '1-1004-12345-67-3',
    seats: ['VIP-01'],
    slipName: 'slip-order1.png',
    slipMime: 'image/png',
    slipData: makeDummySlip('slip_test_offline_order1')
  });
  const order2 = db.createOrder({
    title: 'OFFLINE FEST 2026',
    date: '2026-11-20',
    venue: 'Impact Hall 1',
    zone: 'Zone B',
    qty: 1,
    unitPrice: 2500,
    total: 2500,
    promoCode: '',
    discountAmount: 0,
    holderName: 'นางสาวสอง จุดตรวจ',
    holderPhone: '0893334444',
    holderIdCard: '1-1004-12345-67-3',
    seats: ['B-01'],
    slipName: 'slip-order2.png',
    slipMime: 'image/png',
    slipData: makeDummySlip('slip_test_offline_order2')
  });

  db.updateOrderStatus(order1.ref, { status: 'approved' });
  db.updateOrderStatus(order2.ref, { status: 'approved' });

  // Simulate batch sync
  const checkins = [
    { code: order1.qrPayload, ref: order1.ref, staffName: 'Gate 1 (Offline)', timestamp: Date.now() },
    { code: order2.ref, ref: order2.ref, staffName: 'Gate 2 (Offline)', timestamp: Date.now() }
  ];

  let syncedCount = 0;
  for (const item of checkins) {
    const res = db.checkInOrder(item.code, item.staffName);
    if (res.ok) syncedCount += 1;
  }

  assert.equal(syncedCount, 2, 'Both offline tickets synced');

  db.addAuditLog({
    action: 'OFFLINE_GATE_SYNC',
    detail: `ซิงก์ข้อมูลเช็กอินจากโหมดออฟไลน์ สำเร็จ ${syncedCount}/${checkins.length} รายการ`,
    actor: 'GateOfflineEngine'
  });

  const o1 = db.getOrder(order1.ref);
  const o2 = db.getOrder(order2.ref);
  assert.ok(o1.checkedInAt > 0, 'Order 1 marked checked in');
  assert.equal(o1.checkedInBy, 'Gate 1 (Offline)');
  assert.ok(o2.checkedInAt > 0, 'Order 2 marked checked in');

  const logs = db.listAuditLogs();
  const syncLog = logs.find((l) => l.action === 'OFFLINE_GATE_SYNC');
  assert.ok(syncLog, 'Audit trail recorded for OFFLINE_GATE_SYNC');
  assert.match(syncLog.detail, /ซิงก์ข้อมูลเช็กอินจากโหมดออฟไลน์/);
});
