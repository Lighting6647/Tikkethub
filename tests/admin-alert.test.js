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
