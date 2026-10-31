const test = require('node:test');
const assert = require('node:assert/strict');
const { sendAdminNewOrderNotification } = require('../backend/line');
const db = require('../backend/db');

test('sendAdminNewOrderNotification: validates missing token or adminUserId', async () => {
  const res1 = await sendAdminNewOrderNotification('', 'U1234567890abcdef1234567890abcdef', { ref: 'TT-TEST', total: 1000 });
  assert.equal(res1.ok, false);

  const res2 = await sendAdminNewOrderNotification('TOKEN123', '', { ref: 'TT-TEST', total: 1000 });
  assert.equal(res2.ok, false);
});

test('db handles admin_line_user_id setting persistence', () => {
  db.setSetting('admin_line_user_id', 'U4af4980629test');
  assert.equal(db.getSetting('admin_line_user_id'), 'U4af4980629test');
  db.setSetting('admin_line_user_id', '');
  assert.equal(db.getSetting('admin_line_user_id'), '');
});

test('storefront settings and event poster images persist properly', () => {
  const testPayload = JSON.stringify({
    headline: 'PROMO TOUR 2026',
    promoImage: 'https://example.com/promo-banner.jpg'
  });
  db.setSetting('storefront_settings', testPayload);
  const retrieved = JSON.parse(db.getSetting('storefront_settings'));
  assert.equal(retrieved.headline, 'PROMO TOUR 2026');
  assert.equal(retrieved.promoImage, 'https://example.com/promo-banner.jpg');

  // Verify event image support
  const savedEvents = db.saveEvent({
    title: 'PROMO TEST CONCERT',
    venue: 'Impact Arena',
    date: '31 Dec 2026',
    image: 'https://example.com/poster.jpg',
    quotaVip: 10,
    quotaA: 20,
    quotaB: 30,
    quotaC: 40
  });
  const savedEv = savedEvents.find(e => e.title === 'PROMO TEST CONCERT');
  assert.ok(savedEv);
  assert.equal(savedEv.image, 'https://example.com/poster.jpg');
});
