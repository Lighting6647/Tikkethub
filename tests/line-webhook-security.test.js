const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { computeLineSignature, validateLineWebhookSignature } = require('../backend/line');
const db = require('../backend/db');
const requestHandler = require('../server');
const { createAdminToken } = require('../server');

test('computeLineSignature generates valid HMAC-SHA256 Base64 hash', () => {
  const secret = 'test-channel-secret-123456';
  const body = JSON.stringify({ events: [{ type: 'message', message: { text: 'สวัสดี' } }] });
  const sig = computeLineSignature(body, secret);

  assert.ok(typeof sig === 'string' && sig.length > 20, 'Signature should be non-empty base64 string');

  // Verify against independent crypto.createHmac
  const expected = crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64');
  assert.equal(sig, expected);
});

test('validateLineWebhookSignature accurately accepts valid and rejects tampered signatures', () => {
  const secret = 'super-secret-line-key-999';
  const body = '{"events":[{"type":"follow","source":{"userId":"U1234567890abcdef"}}]}';
  const validSig = computeLineSignature(body, secret);

  // 1. Valid Signature
  const resValid = validateLineWebhookSignature(body, validSig, secret);
  assert.equal(resValid.ok, true);
  assert.equal(resValid.verified, true);
  assert.equal(resValid.reason, 'VALID_SIGNATURE');

  // 2. Tampered Payload with original signature
  const tamperedBody = body.replace('U1234567890abcdef', 'UHACKED1234567890');
  const resTampered = validateLineWebhookSignature(tamperedBody, validSig, secret);
  assert.equal(resTampered.ok, false);
  assert.equal(resTampered.verified, false);
  assert.equal(resTampered.reason, 'INVALID_SIGNATURE');

  // 3. Completely bogus signature
  const resBogus = validateLineWebhookSignature(body, 'bogusSignatureBase64==', secret);
  assert.equal(resBogus.ok, false);
  assert.equal(resBogus.verified, false);

  // 4. Missing signature when secret is configured
  const resMissing = validateLineWebhookSignature(body, '', secret);
  assert.equal(resMissing.ok, false);
  assert.equal(resMissing.reason, 'MISSING_SIGNATURE');

  // 5. Secret not configured (local dev/simulator mode fallback)
  const resNoSecret = validateLineWebhookSignature(body, '', '');
  assert.equal(resNoSecret.ok, true);
  assert.equal(resNoSecret.verified, false);
  assert.equal(resNoSecret.reason, 'SECRET_NOT_CONFIGURED');
});

test('HTTP POST /api/line/webhook enforces signature verification & rate limiting', async () => {
  // Mock request/response helper
  function mockReqRes({ method, path, headers = {}, body = '' }) {
    const stream = new (require('node:stream').Readable)();
    stream.push(body);
    stream.push(null);
    stream.method = method;
    stream.url = path;
    stream.headers = headers;

    return new Promise((resolve) => {
      let statusCode = 200;
      const resHeaders = {};
      let responseBody = '';

      const res = {
        writeHead: (code, hdrs) => {
          statusCode = code;
          if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) {
              resHeaders[k.toLowerCase()] = v;
              resHeaders[k] = v;
            }
          }
        },
        setHeader: (name, val) => {
          resHeaders[name.toLowerCase()] = val;
          resHeaders[name] = val;
        },
        end: (data) => {
          if (data) responseBody += data;
          let json = null;
          try { json = JSON.parse(responseBody); } catch (_) {}
          resolve({ statusCode, headers: resHeaders, body: responseBody, json });
        }
      };

      requestHandler(stream, res);
    });
  }

  const testSecret = 'channel-secret-test-webhook';
  db.setSetting('line_channel_secret', testSecret);

  const payloadStr = JSON.stringify({
    events: [
      {
        type: 'message',
        replyToken: 'token123',
        source: { userId: 'U22e8f8c71ad28f6ae4c3eece3f6c39d4', displayName: 'ลูกค้าทดสอบ' },
        message: { text: 'ขอข้อมูลบัตรคอนเสิร์ต' }
      }
    ]
  });

  // 1. Rejected with HTTP 401 when signature is invalid
  const resBad = await mockReqRes({
    method: 'POST',
    path: '/api/line/webhook',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': 'invalid-signature-base64='
    },
    body: payloadStr
  });
  assert.equal(resBad.statusCode, 401);
  assert.equal(resBad.json.ok, false);
  assert.equal(resBad.json.code, 'INVALID_SIGNATURE');

  // Verify security audit log was recorded
  const auditLogs = db.listAuditLogs(5);
  const foundAudit = auditLogs.some((l) => l.action === 'LINE_WEBHOOK_SIGNATURE_FAILED');
  assert.equal(foundAudit, true, 'Audit log should record signature failure');

  // 2. Accepted with HTTP 200 when signature is valid
  const validSig = computeLineSignature(payloadStr, testSecret);
  const resGood = await mockReqRes({
    method: 'POST',
    path: '/api/line/webhook',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': validSig
    },
    body: payloadStr
  });
  assert.equal(resGood.statusCode, 200);
  assert.equal(resGood.json.ok, true);
  assert.equal(resGood.json.verified, true);
  assert.ok(Array.isArray(resGood.json.results));

  // 3. Test Rate Limiter (Spam Protection)
  // Bombard endpoint until rate limit triggers (120 reqs/min per IP)
  let rateLimitedRes = null;
  for (let i = 0; i < 130; i++) {
    const r = await mockReqRes({
      method: 'POST',
      path: '/api/line/webhook',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': validSig
      },
      body: payloadStr
    });
    if (r.statusCode === 429) {
      rateLimitedRes = r;
      break;
    }
  }
  assert.ok(rateLimitedRes, 'Rate limiter should trigger HTTP 429 after 120 calls');
  assert.equal(rateLimitedRes.statusCode, 429);
  assert.equal(rateLimitedRes.json.code, 'RATE_LIMITED');
  assert.equal(rateLimitedRes.headers['retry-after'], '60');

  // Reset rate limits and clean up test secret
  requestHandler.resetRateLimitsForTest();
  db.setSetting('line_channel_secret', '');
});

test('GET/PUT /api/settings manages LINE Channel Secret securely', async () => {
  function mockReqRes({ method, path, headers = {}, body = '' }) {
    const stream = new (require('node:stream').Readable)();
    stream.push(body);
    stream.push(null);
    stream.method = method;
    stream.url = path;
    stream.headers = headers;

    return new Promise((resolve) => {
      let statusCode = 200;
      const resHeaders = {};
      let responseBody = '';

      const res = {
        writeHead: (code, hdrs) => {
          statusCode = code;
          if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) {
              resHeaders[k.toLowerCase()] = v;
              resHeaders[k] = v;
            }
          }
        },
        setHeader: (name, val) => {
          resHeaders[name.toLowerCase()] = val;
          resHeaders[name] = val;
        },
        end: (data) => {
          if (data) responseBody += data;
          let json = null;
          try { json = JSON.parse(responseBody); } catch (_) {}
          resolve({ statusCode, headers: resHeaders, body: responseBody, json });
        }
      };

      requestHandler(stream, res);
    });
  }

  const adminToken = createAdminToken('admin');

  // 1. Save new Channel Secret via PUT /api/settings
  const updateRes = await mockReqRes({
    method: 'PUT',
    path: '/api/settings',
    headers: {
      'content-type': 'application/json',
      cookie: `tt_admin_session=${adminToken}`
    },
    body: JSON.stringify({
      lineChannelSecret: 'my-super-channel-secret-12345'
    })
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.json.ok, true);

  // 2. Fetch via GET /api/settings - should be masked
  const getRes = await mockReqRes({
    method: 'GET',
    path: '/api/settings',
    headers: {
      cookie: `tt_admin_session=${adminToken}`
    }
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json.ok, true);
  assert.equal(getRes.json.hasLineSecret, true);
  assert.ok(getRes.json.lineSecretMasked.includes('••'));
  assert.equal(db.getSetting('line_channel_secret'), 'my-super-channel-secret-12345');

  // Clean up
  db.setSetting('line_channel_secret', '');
});

test('GET /api/admin/system-health and POST /api/admin/line/webhook-ping work with admin auth', async () => {
  function mockReqRes({ method, path, headers = {}, body = '' }) {
    const stream = new (require('node:stream').Readable)();
    stream.push(body);
    stream.push(null);
    stream.method = method;
    stream.url = path;
    stream.headers = headers;

    return new Promise((resolve) => {
      let statusCode = 200;
      const resHeaders = {};
      let responseBody = '';

      const res = {
        writeHead: (code, hdrs) => {
          statusCode = code;
          if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) {
              resHeaders[k.toLowerCase()] = v;
              resHeaders[k] = v;
            }
          }
        },
        setHeader: (name, val) => {
          resHeaders[name.toLowerCase()] = val;
          resHeaders[name] = val;
        },
        end: (data) => {
          if (data) responseBody += data;
          let json = null;
          try { json = JSON.parse(responseBody); } catch (_) {}
          resolve({ statusCode, headers: resHeaders, body: responseBody, json });
        }
      };

      requestHandler(stream, res);
    });
  }

  const adminToken = createAdminToken('admin');

  // Unauthorized requests should report unauthorized: true
  const unauthHealth = await mockReqRes({ method: 'GET', path: '/api/admin/system-health' });
  assert.equal(unauthHealth.json.unauthorized, true);

  const unauthPing = await mockReqRes({ method: 'POST', path: '/api/admin/line/webhook-ping', body: '{}' });
  assert.equal(unauthPing.json.unauthorized, true);

  // Authorized system-health
  const healthRes = await mockReqRes({
    method: 'GET',
    path: '/api/admin/system-health',
    headers: { cookie: `tt_admin_session=${adminToken}` }
  });
  assert.equal(healthRes.statusCode, 200);
  assert.equal(healthRes.json.ok, true);
  assert.equal(typeof healthRes.json.journalMode, 'string');
  assert.equal(typeof healthRes.json.memoryRssMB, 'number');
  assert.equal(typeof healthRes.json.uptimeSec, 'number');

  // Authorized webhook-ping with secret
  const pingWithSecret = await mockReqRes({
    method: 'POST',
    path: '/api/admin/line/webhook-ping',
    headers: {
      'content-type': 'application/json',
      cookie: `tt_admin_session=${adminToken}`
    },
    body: JSON.stringify({ lineChannelSecret: 'ping-secret-12345' })
  });
  assert.equal(pingWithSecret.statusCode, 200);
  assert.equal(pingWithSecret.json.ok, true);
  assert.equal(pingWithSecret.json.signatureConfigured, true);
  assert.equal(pingWithSecret.json.signatureVerified, true);
  assert.equal(pingWithSecret.json.webhookPath, '/api/line/webhook');
});
