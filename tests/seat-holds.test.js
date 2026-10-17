const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../backend/db');

test('Seat Hold Engine: successfully holds available seats for a session', () => {
  db.clearAllForTest();

  const sess1 = 'sess_user_alpha';
  const res = db.holdSeats(['VIP-01', 'VIP-02'], sess1, 600000);

  assert.equal(res.ok, true);
  assert.deepEqual(res.heldSeats, ['VIP-01', 'VIP-02']);
  assert.equal(res.remainingSeconds, 600);
  assert.ok(res.expiresAt > Date.now());

  // Check statuses
  const statusRes = db.getSeatStatuses(sess1);
  assert.equal(statusRes.ok, true);
  assert.equal(statusRes.seats['VIP-01'].status, 'held_by_me');
  assert.equal(statusRes.seats['VIP-02'].status, 'held_by_me');
  assert.equal(statusRes.seats['VIP-05'].status, 'available');
  assert.equal(statusRes.seats['VIP-03'].status, 'occupied'); // baseline occupied
});

test('Seat Hold Engine: prevents race-condition double hold by other session', () => {
  const sess1 = 'sess_user_alpha';
  const sess2 = 'sess_user_beta';

  // User 2 tries to hold VIP-01 (held by User 1)
  const conflictRes = db.holdSeats(['VIP-01', 'VIP-05'], sess2, 600000);
  assert.equal(conflictRes.ok, false);
  assert.deepEqual(conflictRes.conflictSeats, ['VIP-01']);
  assert.match(conflictRes.message, /VIP-01/);

  // User 2 status view should show held_by_other
  const statusRes = db.getSeatStatuses(sess2);
  assert.equal(statusRes.seats['VIP-01'].status, 'held_by_other');
});

test('Seat Hold Engine: releases seats so other sessions can acquire them', () => {
  const sess1 = 'sess_user_alpha';
  const sess2 = 'sess_user_beta';

  const rel = db.releaseSeats(['VIP-01'], sess1);
  assert.equal(rel.ok, true);

  // Now User 2 can acquire VIP-01
  const hold2 = db.holdSeats(['VIP-01'], sess2, 600000);
  assert.equal(hold2.ok, true);
  assert.deepEqual(hold2.heldSeats, ['VIP-01']);
});

test('Promoter Analytics: returns accurate KPIs, zone heatmap and velocity', () => {
  db.clearAllForTest();

  const sampleSlipData = 'data:image/png;base64,' + Buffer.alloc(1024, 0x42).toString('base64');
  const order = db.createOrder({
    title: 'ECHOES OF ASIA WORLD TOUR 2026',
    date: '14 - 15 พ.ย. 2026',
    venue: 'อิมแพ็ค อารีน่า เมืองทองธานี',
    zone: 'VIP Standing',
    qty: 2,
    unitPrice: 6500,
    total: 13000,
    promoCode: '',
    discountAmount: 0,
    seats: ['VIP-07', 'VIP-08'],
    holderName: 'คุณสมชาย สายเปย์',
    holderPhone: '0819998888',
    slipName: 'slip-test.png',
    slipMime: 'image/png',
    slipData: sampleSlipData
  });

  // Approve order to register revenue
  db.updateOrderStatus(order.ref, { status: 'approved' });

  const analytics = db.getPromoterAnalytics();
  assert.equal(analytics.ok, true);
  assert.equal(analytics.kpis.totalNetRevenue, 13000);
  assert.equal(analytics.kpis.totalTicketsSold, 2);
  assert.equal(analytics.kpis.aov, 13000);
  assert.equal(analytics.kpis.approvedOrders, 1);
  assert.ok(analytics.zones.VIP.sold >= 2);
  assert.ok(analytics.zones.VIP.revenue >= 13000);
  assert.ok(Array.isArray(analytics.hourlyVelocity));
  assert.equal(analytics.hourlyVelocity.length, 6);
});
