const test = require('node:test');
const assert = require('node:assert/strict');
const slipVerifier = require('../backend/slip-verifier');
const db = require('../backend/db');

test('Slip Verifier: smart simulator verifies valid amount', async () => {
  db.setSetting('slip_verify_provider', 'simulator');
  db.setSetting('slip_auto_approve_enabled', 'false');

  const order = { ref: 'TEST-SIM-1', total: 3600 };
  const result = await slipVerifier.verifySlip({
    order,
    slipDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  });

  assert.equal(result.verified, true);
  assert.equal(result.autoApproved, false);
  assert.equal(result.provider, 'Smart Simulator');
  assert.equal(result.amount, 3600);
  assert.match(result.transRef, /^SIM-/);
});

test('Slip Verifier: auto-approve toggle triggers approval', async () => {
  db.setSetting('slip_verify_provider', 'simulator');
  db.setSetting('slip_auto_approve_enabled', 'true');

  const order = { ref: 'TEST-SIM-2', total: 6500 };
  const result = await slipVerifier.verifySlip({
    order,
    slipDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  });

  assert.equal(result.verified, true);
  assert.equal(result.autoApproved, true);
  assert.equal(result.amount, 6500);
});
