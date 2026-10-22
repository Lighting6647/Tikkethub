/**
 * Thai Ticket Concert Server
 * Serves static frontend + Admin dashboard + Gate Scanner + REST API:
 * - Orders & SHA-256 duplicate slip detection
 * - Admin PIN Login & HMAC Session protection + Rate Limiting
 * - LINE Official Account Push & Webhook Auto-Reply
 * - Gate Check-in QR Scanner (anti-passback)
 * - CSV/Excel Export
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const db = require('./backend/db');
const { sendLineTicketPush, replyLineWebhook, sendAdminNewOrderNotification } = require('./backend/line');
const drive = require('./backend/drive');
const slipVerifier = require('./backend/slip-verifier');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const SESSION_SECRET = process.env.SESSION_SECRET || 'thaiticket-hmac-secret-2026';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

// Sliding-window Rate Limiter
const rateBuckets = new Map();
function checkRateLimit(key, limit, windowMs = 60000) {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    rateBuckets.set(key, timestamps);
    return { allowed: false, remaining: 0 };
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return { allowed: true, remaining: Math.max(0, limit - timestamps.length) };
}

function resetRateLimitsForTest() {
  rateBuckets.clear();
}

// Real-time SSE Seat Hold Stream & Server-Side Expiration Worker
const sseSeatClients = new Set();

function broadcastSeatSync(reason = 'update') {
  if (sseSeatClients.size === 0) return;
  for (const client of sseSeatClients) {
    try {
      const payload = {
        ...db.getSeatStatuses(client.sessionId),
        reason,
        timestamp: Date.now()
      };
      client.res.write(`event: seat_sync\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      sseSeatClients.delete(client);
    }
  }
}

const seatExpirationWorker = setInterval(() => {
  try {
    const purged = db.cleanExpiredHolds();
    if (purged > 0) {
      broadcastSeatSync('expired_cleanup');
    }
  } catch {
    /* ignore */
  }
}, 2000);
if (typeof seatExpirationWorker.unref === 'function') {
  seatExpirationWorker.unref();
}

// Admin & Gate Staff Session Token (HMAC-SHA256)
function createAdminToken(role = 'admin') {
  const safeRole = role === 'gate_staff' ? 'gate_staff' : 'admin';
  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
  const payload = `${safeRole}.${exp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function getTokenRole(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'admin' && parts[0] !== 'gate_staff') return null;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('hex');
  return parts[2] === expected ? parts[0] : null;
}

function verifyAdminToken(token) {
  return Boolean(getTokenRole(token));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function getAuthRole(req) {
  const cookies = parseCookies(req);
  const cookieRole = getTokenRole(cookies.tt_admin_session);
  if (cookieRole) return cookieRole;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return getTokenRole(auth.slice(7).trim());
  }
  return null;
}

function isAdminAuthenticated(req) {
  return Boolean(getAuthRole(req));
}

function isFullAdmin(req) {
  return getAuthRole(req) === 'admin';
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('ข้อมูลขนาดใหญ่เกินกำหนด'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('รูปแบบข้อมูล JSON ไม่ถูกต้อง'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function validateOrderPayload(body) {
  if (!body || typeof body !== 'object') return 'ข้อมูลไม่ถูกต้อง';
  if (!body.title || !body.date || !body.venue || !body.zone) return 'ข้อมูลคอนเสิร์ตไม่ครบถ้วน';
  if (!Number.isInteger(Number(body.qty)) || Number(body.qty) < 1 || Number(body.qty) > 4) {
    return 'จำนวนบัตรต้องอยู่ระหว่าง 1 ถึง 4 ใบ';
  }
  const holderName = String(body.holderName || '').trim();
  if (holderName.length < 2) return 'กรุณากรอกชื่อ-นามสกุลผู้ถือบัตร';
  const digits = String(body.holderPhone || '').replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 10) return 'กรุณากรอกเบอร์โทรศัพท์ 9-10 หลักให้ถูกต้อง';
  const idRaw = String(body.holderIdCard || '').trim();
  const idDigits = idRaw.replace(/\D/g, '');
  if (!idRaw) {
    return 'กรุณากรอกเลขประจำตัวประชาชน 13 หลัก หรือเลขพาสปอร์ต';
  }
  if (idDigits.length !== 13 && idRaw.length < 7) {
    return 'กรุณากรอกเลขประจำตัวประชาชน 13 หลัก หรือเลขพาสปอร์ตให้ถูกต้อง';
  }
  if (!body.slipData || !String(body.slipData).startsWith('data:image/')) {
    return 'กรุณาแนบรูปสลิปการโอนเงิน';
  }
  return null;
}

function maskToken(token) {
  if (!token || token.length < 12) return token ? '••••••••' : '';
  return token.slice(0, 6) + '••••••••' + token.slice(-4);
}

function buildCsv(orders) {
  const headers = [
    'รหัสการจอง (Ref)',
    'คอนเสิร์ต',
    'วันที่แสดง',
    'สถานที่',
    'โซน',
    'จำนวน (ใบ)',
    'ราคาต่อใบ (THB)',
    'ยอดชำระรวม (THB)',
    'ชื่อผู้ถือบัตร',
    'เบอร์โทรศัพท์',
    'เลขบัตรประชาชน / Passport',
    'LINE User ID',
    'สถานะสลิป',
    'ส่งบัตรผ่าน LINE',
    'สถานะเข้างาน (Check-in)',
    'เวลาสั่งซื้อ'
  ];

  const escCsv = (val) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const statusText = (s) =>
    s === 'approved' ? 'อนุมัติแล้ว' : s === 'rejected' ? 'ปฏิเสธ' : 'รอตรวจสอบ';
  const lineText = (m) =>
    m === 1 ? 'ส่งเข้า LINE สำเร็จ' : m === 2 ? 'พร้อมส่ง (พรีวิว Flex)' : 'ยังไม่ส่ง';
  const checkInText = (t) =>
    t > 0 ? `เข้างานแล้ว (${new Date(t).toLocaleString('th-TH')})` : 'ยังไม่เข้างาน';

  const rows = orders.map((o) =>
    [
      o.ref,
      o.title,
      o.date,
      o.venue,
      o.zone,
      o.qty,
      o.unitPrice,
      o.total,
      o.holderName,
      o.holderPhone,
      o.holderIdCard || '',
      o.lineUserId,
      statusText(o.status),
      lineText(o.lineSent),
      checkInText(o.checkedInAt),
      new Date(o.issuedAt).toLocaleString('th-TH')
    ]
      .map(escCsv)
      .join(',')
  );

  return '\uFEFF' + [headers.map(escCsv).join(','), ...rows].join('\r\n');
}

function buildGuestListCsv(orders) {
  const headers = [
    'ลำดับ',
    'รหัสการจอง (Ref)',
    'คอนเสิร์ต',
    'รอบการแสดง',
    'โซนที่นั่ง',
    'เลขที่นั่ง (Seat Codes)',
    'จำนวนบัตร (ใบ)',
    'ชื่อ-นามสกุล ผู้ถือบัตร',
    'เลขบัตรประชาชน / Passport',
    'เบอร์โทรศัพท์ติดต่อ',
    'LINE User ID',
    'สถานะการชำระเงิน',
    'สถานะการตรวจเข้างาน',
    'เวลาตรวจเข้างาน (Check-in)',
    'จุดตรวจ/เจ้าหน้าที่สแกน',
    'พยายามเข้าซ้ำ (ครั้ง)',
    'เวลาทำรายการสั่งซื้อ'
  ];

  const escCsv = (val) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const statusText = (s) =>
    s === 'approved' ? 'อนุมัติแล้ว (สิทธิ์เข้างานสมบูรณ์)' : s === 'rejected' ? 'ปฏิเสธ' : 'รอตรวจสอบ';
  const checkInText = (t) =>
    t > 0 ? 'เข้างานแล้ว' : 'ยังไม่เข้างาน';
  const checkInTimeText = (t) =>
    t > 0 ? new Date(t).toLocaleString('th-TH') : '-';

  const rows = orders.map((o, idx) => {
    const seatsText = Array.isArray(o.seats) && o.seats.length ? o.seats.join(', ') : (o.zone || '-');
    return [
      idx + 1,
      o.ref,
      o.title,
      o.date,
      o.zone,
      seatsText,
      o.qty,
      o.holderName,
      o.holderIdCard || '',
      o.holderPhone,
      o.lineUserId,
      statusText(o.status),
      checkInText(o.checkedInAt),
      checkInTimeText(o.checkedInAt),
      o.checkedInBy || '-',
      o.reEntryAttempts || 0,
      new Date(o.issuedAt).toLocaleString('th-TH')
    ]
      .map(escCsv)
      .join(',');
  });

  return '\uFEFF' + [headers.map(escCsv).join(','), ...rows].join('\r\n');
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress || '127.0.0.1';

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  // Public payment config for customer checkout QR & bank transfer
  if (method === 'GET' && pathname === '/api/payment-config') {
    const promptpayId = db.getSetting('promptpay_id', '0954654698');
    const merchantName = db.getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.');
    const bankAccount = db.getSetting('bank_account', '');
    const bankName = db.getSetting('bank_name', '');
    return sendJson(res, 200, {
      ok: true,
      promptpayId,
      merchantName,
      bankAccount,
      bankName
    });
  }

  // Admin & Gate Staff Login / Logout / Session check
  if (pathname === '/api/admin/session' && method === 'GET') {
    const role = getAuthRole(req);
    return sendJson(res, 200, { authenticated: Boolean(role), role: role || null });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    const rl = checkRateLimit(`login:${ip}`, 12, 60000);
    if (!rl.allowed) {
      return sendJson(res, 200, {
        ok: false,
        code: 'RATE_LIMITED',
        error: 'พยายามเข้าสู่ระบบเกินจำนวนครั้งที่กำหนด กรุณารอ 1 นาที'
      });
    }
    const body = await readJsonBody(req);
    const pin = String(body.pin || '').trim();
    const expectedAdminPin = db.getSetting('admin_pin', '123456');
    const expectedStaffPin = db.getSetting('gate_staff_pin', '888888');

    let matchedRole = null;
    if (pin === expectedAdminPin) {
      matchedRole = 'admin';
    } else if (pin === expectedStaffPin) {
      matchedRole = 'gate_staff';
    }

    if (!matchedRole) {
      db.addAuditLog({
        action: 'LOGIN_FAILED',
        detail: `พยายามเข้าสู่ระบบด้วยรหัส PIN ไม่ถูกต้อง (IP: ${ip})`,
        actor: 'System'
      });
      return sendJson(res, 200, {
        ok: false,
        error: 'รหัสผ่านแอดมินหรือเจ้าหน้าที่หน้าประตู (PIN) ไม่ถูกต้อง'
      });
    }
    db.addAuditLog({
      action: matchedRole === 'admin' ? 'ADMIN_LOGIN' : 'STAFF_LOGIN',
      detail:
        matchedRole === 'admin'
          ? `เข้าสู่ระบบจัดการแอดมินสำเร็จ (IP: ${ip})`
          : `เข้าสู่ระบบจุดตรวจบัตรหน้างาน (Gate Staff Mode) สำเร็จ (IP: ${ip})`,
      actor: matchedRole === 'admin' ? 'Admin' : 'GateStaff'
    });
    const token = createAdminToken(matchedRole);
    return sendJson(
      res,
      200,
      { ok: true, token, role: matchedRole },
      {
        'Set-Cookie': `tt_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
      }
    );
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return sendJson(
      res,
      200,
      { ok: true },
      {
        'Set-Cookie': 'tt_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
      }
    );
  }

  // LINE Official Account Webhook & 1-click Auto-fill Helper
  if (pathname === '/api/line/webhook' && method === 'POST') {
    const body = await readJsonBody(req);
    const events = Array.isArray(body.events) ? body.events : [];
    const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
    const results = [];

    for (const ev of events) {
      const userId = ev.source && ev.source.userId;
      if (userId) {
        const text = (ev.message && ev.message.text) || ev.type || 'follow';
        db.saveLineContact({
          userId,
          displayName: ev.source.displayName || 'ลูกค้า LINE OA',
          lastMessage: text
        });
        const replyRes = await replyLineWebhook(ev.replyToken, userId, token);
        results.push({ userId, ...replyRes });
      }
    }
    return sendJson(res, 200, { ok: true, results });
  }

  if (pathname === '/api/line/simulate-webhook' && method === 'POST') {
    const body = await readJsonBody(req);
    const latest = db.getLatestLineContact();
    const userId =
      (latest && latest.user_id) ||
      'U' + crypto.randomBytes(16).toString('hex');
    const displayName = String(body.displayName || 'ลูกค้าทักแชท LINE OA').trim();
    const saved = db.saveLineContact({
      userId,
      displayName,
      lastMessage: 'ลงทะเบียนรับบัตรคอนเสิร์ต'
    });
    const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
    const reply = await replyLineWebhook('SIMULATED_REPLY_TOKEN', saved.user_id, token);
    return sendJson(res, 200, {
      ok: true,
      userId: saved.user_id,
      displayName: saved.display_name,
      webhookReply: reply.messages[0].text
    });
  }

  if (pathname === '/api/line/recent-contact' && method === 'GET') {
    const latest = db.getLatestLineContact();
    return sendJson(res, 200, {
      ok: true,
      contact: latest
        ? { userId: latest.user_id, displayName: latest.display_name, updatedAt: latest.updated_at }
        : null
    });
  }

  // Create order + Rate Limiting + Duplicate slip check
  if (method === 'POST' && pathname === '/api/orders') {
    const rl = checkRateLimit(`order:${ip}`, 20, 60000);
    if (!rl.allowed) {
      return sendJson(
        res,
        200,
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'คุณส่งรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'
        },
        { 'X-RateLimit-Remaining': '0' }
      );
    }

    const body = await readJsonBody(req);
    const validationError = validateOrderPayload(body);
    if (validationError) {
      return sendJson(res, 200, { ok: false, error: validationError });
    }
    try {
      const created = db.createOrder(body);
      broadcastSeatSync('order_created');

      // Async Google Drive upload and Slip Verification in background
      (async () => {
        try {
          const comma = (created.slipData || '').indexOf(',');
          const base64Data = comma >= 0 ? created.slipData.slice(comma + 1) : created.slipData;
          const imageBuffer = Buffer.from(base64Data, 'base64');

          // 1. Google Drive Upload
          const driveResult = await drive.uploadSlipToDrive({
            buffer: imageBuffer,
            mimeType: created.slipMime || 'image/png',
            fileName: `${created.ref}_slip_${created.issuedAt}.png`,
            ref: created.ref
          });
          if (driveResult && driveResult.ok && driveResult.viewLink) {
            db.updateOrderDriveAndVerification(created.ref, {
              driveFileId: driveResult.fileId,
              driveViewLink: driveResult.viewLink
            });
            db.addAuditLog({
              action: 'DRIVE_UPLOAD_SUCCESS',
              targetRef: created.ref,
              detail: `อัปโหลดสลิปขึ้น Google Drive สำเร็จ (${driveResult.fileName})`,
              actor: 'GoogleDriveEngine'
            });
          }

          // 2. Slip Automated Verification
          const verifyResult = await slipVerifier.verifySlip({
            order: created,
            slipDataUrl: created.slipData,
            slipBuffer: imageBuffer
          });
          if (verifyResult) {
            const detail = verifyResult.detail || verifyResult.reason || '';
            const verifiedBy = verifyResult.provider || 'SlipVerifier';
            if (verifyResult.autoApproved) {
              const approved = db.updateOrderDriveAndVerification(created.ref, {
                status: 'approved',
                reviewedAt: Date.now(),
                verifiedBy,
                verificationDetail: detail
              });
              db.addAuditLog({
                action: 'AUTO_SLIP_APPROVED',
                targetRef: created.ref,
                detail: `ระบบตรวจสลิปอัตโนมัติอนุมัติรายการ (${verifiedBy})`,
                actor: verifiedBy
              });
              if (approved && approved.lineUserId) {
                const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
                if (token) {
                  const lineRes = await sendLineTicketPush(approved.lineUserId, approved, token);
                  db.updateOrderStatus(approved.ref, {
                    status: 'approved',
                    lineSent: lineRes.ok ? 1 : 0,
                    lineLog: lineRes
                  });
                }
              }
            } else {
              db.updateOrderDriveAndVerification(created.ref, {
                verifiedBy,
                verificationDetail: detail
              });
            }
          }

          // 3. Instant LINE Alert to Admin (if configured)
          const adminLineId = db.getSetting('admin_line_user_id', process.env.ADMIN_LINE_USER_ID || '');
          const lineToken = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
          if (adminLineId && lineToken) {
            await sendAdminNewOrderNotification(lineToken, adminLineId, created);
          }
        } catch (postErr) {
          console.error('[Async Post-Order Error]', postErr);
        }
      })();

      return sendJson(
        res,
        201,
        { ok: true, order: created },
        { 'X-RateLimit-Remaining': String(rl.remaining) }
      );
    } catch (err) {
      if (err.code === 'DUPLICATE_SLIP' || err.status === 400 || err.status === 409) {
        return sendJson(res, 200, { ok: false, code: err.code, error: err.message });
      }
      throw err;
    }
  }

  // Auto-recover / sync orders from browser localStorage ('บัตรของฉัน') to SQLite DB
  if (method === 'POST' && pathname === '/api/orders/recover') {
    const body = await readJsonBody(req);
    const tickets = Array.isArray(body.tickets) ? body.tickets : [];
    const status = body.status || 'all';
    const includeSlip = body.includeSlip !== false;
    const result = db.recoverOrdersFromClient(tickets);
    const fullOrders = db.listOrders({ status, includeSlipData: includeSlip });
    const stats = db.getStats();
    return sendJson(res, 200, {
      ok: true,
      recoveredCount: result.recoveredCount,
      orders: fullOrders,
      stats
    });
  }

  // List orders
  if (method === 'GET' && pathname === '/api/orders') {
    const status = url.searchParams.get('status') || 'all';
    const refsParam = url.searchParams.get('refs');
    const refs = refsParam ? refsParam.split(',').map((s) => s.trim()).filter(Boolean) : null;
    const includeSlip = url.searchParams.get('includeSlip') !== 'false';
    // If listing all orders (Admin view without specific customer refs), require admin auth
    if (!refs && !isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true, orders: [] });
    }
    const orders = db.listOrders({ status, refs, includeSlipData: includeSlip });
    return sendJson(res, 200, { ok: true, orders });
  }

  // Get single order by ref (Public E-Ticket Pass for LINE OA customer)
  const singleOrderMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)$/);
  if (method === 'GET' && singleOrderMatch) {
    const targetRef = singleOrderMatch[1];
    const found = db.getOrder(targetRef);
    if (!found) {
      return sendJson(res, 404, { ok: false, error: 'ไม่พบบัตรรายการนี้' });
    }
    const sanitized = {
      ref: found.ref,
      title: found.title,
      date: found.date,
      venue: found.venue,
      zone: found.zone,
      qty: found.qty,
      seats: found.seats,
      total: found.total,
      holderName: found.holderName,
      holderPhone: found.holderPhone,
      holderIdCard: found.holderIdCard,
      lineUserId: found.lineUserId,
      status: found.status,
      checkedInAt: found.checkedInAt,
      checkedInBy: found.checkedInBy,
      qrSignature: found.qrSignature,
      qrPayload: found.qrPayload,
      issuedAt: found.issuedAt
    };
    return sendJson(res, 200, { ok: true, order: sanitized });
  }

  // Gate Check-in Scanner API
  if (method === 'POST' && pathname === '/api/checkin') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true, message: 'กรุณาเข้าสู่ระบบแอดมิน/สตาฟก่อนสแกนบัตร' });
    }
    const body = await readJsonBody(req);
    if (Array.isArray(body.tickets) && body.tickets.length) {
      db.recoverOrdersFromClient(body.tickets);
    }
    const staffName = body.staffName || 'Gate Staff #1';
    const result = db.checkInOrder(body.code || body.ref || '', staffName);
    db.addAuditLog({
      action: result.ok ? 'GATE_CHECKIN' : `CHECKIN_${result.code || 'BLOCKED'}`,
      targetRef: (result.order && result.order.ref) || String(body.code || ''),
      detail: result.message || 'สแกนบัตรหน้างาน',
      actor: staffName
    });
    return sendJson(res, 200, result);
  }

  // Offline Gate Check-in Roster Cache
  if (method === 'GET' && pathname === '/api/checkin/offline-roster') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const approvedOrders = db.listOrders({ status: 'approved', includeSlipData: false });
    const roster = approvedOrders.map((o) => ({
      ref: o.ref,
      qrPayload: o.qrPayload,
      qrSignature: o.qrSignature,
      title: o.title,
      zone: o.zone,
      qty: o.qty,
      holderName: o.holderName,
      holderPhone: o.holderPhone,
      holderIdCard: o.holderIdCard || '',
      checkedInAt: o.checkedInAt || 0,
      checkedInBy: o.checkedInBy || ''
    }));
    return sendJson(res, 200, {
      ok: true,
      timestamp: Date.now(),
      count: roster.length,
      roster
    });
  }

  // Offline Check-ins Batch Sync
  if (method === 'POST' && pathname === '/api/checkin/sync') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const body = await readJsonBody(req);
    const checkins = Array.isArray(body.checkins) ? body.checkins : [];
    const results = [];
    let syncedCount = 0;

    for (const item of checkins) {
      const code = item.code || item.ref || '';
      const staffName = item.staffName || 'Gate Staff (Offline Sync)';
      const resCheck = db.checkInOrder(code, staffName);
      if (resCheck.ok) syncedCount += 1;
      results.push({
        ref: (resCheck.order && resCheck.order.ref) || code,
        ok: resCheck.ok,
        code: resCheck.code,
        message: resCheck.message
      });
    }

    if (checkins.length > 0) {
      db.addAuditLog({
        action: 'OFFLINE_GATE_SYNC',
        detail: `ซิงก์ข้อมูลเช็กอินจากโหมดออฟไลน์ สำเร็จ ${syncedCount}/${checkins.length} รายการ`,
        actor: 'GateOfflineEngine'
      });
    }

    return sendJson(res, 200, {
      ok: true,
      total: checkins.length,
      syncedCount,
      results
    });
  }

  // Live Gate Throughput & Queue Monitor API
  if (method === 'GET' && pathname === '/api/checkin/gate-monitor') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    return sendJson(res, 200, db.getGateThroughputMonitor());
  }

  // Bulk Slip Approval, Batch Gate Check-in & Bulk Reject API
  if (method === 'POST' && pathname === '/api/admin/orders/bulk-action') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true, error: 'กรุณาเข้าสู่ระบบแอดมินก่อนดำเนินการ' });
    }
    const body = await readJsonBody(req);
    if (Array.isArray(body.tickets) && body.tickets.length) {
      db.recoverOrdersFromClient(body.tickets);
    }
    const refs = Array.isArray(body.refs)
      ? body.refs.map((r) => String(r || '').trim().toUpperCase()).filter(Boolean)
      : [];
    const action = String(body.action || 'approve').trim().toLowerCase();
    if ((action === 'approve' || action === 'reject' || action === 'delete') && !isFullAdmin(req)) {
      return sendJson(res, 200, {
        ok: false,
        forbidden: true,
        error: 'สิทธิ์เจ้าหน้าที่จุดตรวจบัตรไม่สามารถอนุมัติ ปฏิเสธ หรือลบรายการได้'
      });
    }
    const staffName = String(body.staffName || 'Gate A (Bulk)').trim();
    const reason = String(body.reason || 'ไม่ผ่านการตรวจสอบแบบกลุ่ม').trim();

    if (!refs.length) {
      return sendJson(res, 200, { ok: false, error: 'กรุณาเลือกรายการคำสั่งซื้ออย่างน้อย 1 รายการ' });
    }

    const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
    const results = [];
    let successCount = 0;

    for (const ref of refs) {
      if (action === 'delete') {
        const delRes = db.deleteOrder(ref);
        if (delRes.ok) {
          successCount += 1;
          results.push({ ref, ok: true, deleted: true });
        } else {
          results.push({ ref, ok: false, error: delRes.error || 'ลบไม่สำเร็จ' });
        }
        continue;
      }
      const existing = db.getOrder(ref);
      if (!existing) {
        results.push({ ref, ok: false, error: 'ไม่พบรายการ' });
        continue;
      }
      if (action === 'approve') {
        const lineResult = await sendLineTicketPush(existing, token);
        const updated = db.updateOrderStatus(ref, {
          status: 'approved',
          rejectReason: '',
          lineSent: lineResult.sentMode,
          lineLog: lineResult
        });
        successCount += 1;
        results.push({ ref, ok: true, status: updated.status, order: updated });
      } else if (action === 'checkin') {
        if (existing.status !== 'approved') {
          results.push({ ref, ok: false, error: 'ยังไม่อนุมัติสลิป' });
          continue;
        }
        const checkRes = db.checkInOrder(existing.qrPayload || existing.ref, staffName);
        if (checkRes.ok) {
          successCount += 1;
          results.push({ ref, ok: true, checkedInAt: checkRes.order.checkedInAt, order: checkRes.order });
        } else {
          results.push({ ref, ok: false, error: checkRes.message });
        }
      } else if (action === 'reject') {
        const updated = db.updateOrderStatus(ref, {
          status: 'rejected',
          rejectReason: reason,
          lineSent: 0,
          lineLog: null
        });
        successCount += 1;
        results.push({ ref, ok: true, status: updated.status, order: updated });
      }
    }

    if ((action === 'reject' || action === 'delete') && successCount > 0) {
      broadcastSeatSync(action === 'delete' ? 'bulk_order_deleted' : 'bulk_order_rejected');
    }

    db.addAuditLog({
      action:
        action === 'approve'
          ? 'BULK_APPROVE_SLIP'
          : action === 'checkin'
            ? 'BULK_GATE_CHECKIN'
            : action === 'delete'
              ? 'BULK_DELETE_ORDER'
              : 'BULK_REJECT_SLIP',
      targetRef: refs.slice(0, 4).join(', ') + (refs.length > 4 ? ` (+${refs.length - 4})` : ''),
      detail: `ดำเนินการแบบกลุ่ม (${action.toUpperCase()}) สำเร็จ ${successCount}/${refs.length} รายการ`,
      actor: 'Admin'
    });

    return sendJson(res, 200, {
      ok: true,
      action,
      totalRequested: refs.length,
      successCount,
      results
    });
  }

  // Single order operations
  const orderMatch = pathname.match(/^\/api\/orders\/([A-Z0-9-]+)(?:\/(approve|reject|send-line|delete))?$/);
  if (orderMatch) {
    const ref = orderMatch[1];
    const action = orderMatch[2] || (method === 'DELETE' ? 'delete' : undefined);
    const body = method === 'POST' ? await readJsonBody(req) : {};
    if (action !== 'delete' && body && (body.orderSnapshot || Array.isArray(body.tickets))) {
      db.recoverOrdersFromClient(Array.isArray(body.tickets) ? body.tickets : [body.orderSnapshot]);
    }
    const existing = db.getOrder(ref);
    if (!existing && action !== 'delete') {
      return sendJson(res, 404, { error: 'ไม่พบรายการจองนี้ในระบบ' });
    }

    if (method === 'GET' && !action) {
      return sendJson(res, 200, { order: existing });
    }

    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true, error: 'กรุณาเข้าสู่ระบบแอดมินก่อนดำเนินการ' });
    }

    if ((action === 'approve' || action === 'reject' || action === 'delete') && !isFullAdmin(req)) {
      return sendJson(res, 200, {
        ok: false,
        forbidden: true,
        error: 'สิทธิ์เจ้าหน้าที่จุดตรวจบัตรไม่สามารถอนุมัติ ปฏิเสธ หรือลบรายการได้'
      });
    }

    if ((method === 'POST' || method === 'DELETE') && action === 'delete') {
      const delRes = db.deleteOrder(ref);
      broadcastSeatSync('order_deleted');
      db.addAuditLog({
        action: 'DELETE_ORDER',
        targetRef: ref,
        detail: `ลบคำสั่งซื้อ ${ref}${existing ? ` ของ ${existing.holderName} (${existing.zone})` : ''}`,
        actor: 'Admin'
      });
      return sendJson(res, 200, { ok: true, deletedRef: ref });
    }

    if (method === 'POST' && action === 'approve') {
      const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
      const lineResult = await sendLineTicketPush(existing, token);
      const updated = db.updateOrderStatus(ref, {
        status: 'approved',
        rejectReason: '',
        lineSent: lineResult.sentMode,
        lineLog: lineResult
      });
      db.addAuditLog({
        action: 'APPROVE_SLIP',
        targetRef: ref,
        detail: `อนุมัติสลิปยอด ${Number(existing.total).toLocaleString('th-TH')} THB ของ ${existing.holderName} (${existing.zone} · ${existing.qty} ใบ)`,
        actor: 'Admin'
      });
      return sendJson(res, 200, { ok: true, order: updated, lineResult });
    }

    if (method === 'POST' && action === 'reject') {
      const reason = String(body.reason || 'สลิปไม่ถูกต้องหรือยอดเงินไม่ตรง').trim();
      const updated = db.updateOrderStatus(ref, {
        status: 'rejected',
        rejectReason: reason,
        lineSent: 0,
        lineLog: null
      });
      broadcastSeatSync('order_rejected');
      db.addAuditLog({
        action: 'REJECT_SLIP',
        targetRef: ref,
        detail: `ปฏิเสธสลิปของ ${existing.holderName} เหตุผล: ${reason}`,
        actor: 'Admin'
      });
      return sendJson(res, 200, { ok: true, order: updated });
    }

    if (method === 'POST' && action === 'send-line') {
      if (existing.status !== 'approved') {
        return sendJson(res, 200, { ok: false, error: 'ต้องอนุมัติสลิปก่อนจึงจะส่งบัตรเข้า LINE ได้' });
      }
      const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
      const lineResult = await sendLineTicketPush(existing, token);
      const updated = db.updateOrderStatus(ref, {
        status: 'approved',
        rejectReason: '',
        lineSent: lineResult.sentMode,
        lineLog: lineResult
      });
      db.addAuditLog({
        action: 'RESEND_LINE',
        targetRef: ref,
        detail: `ส่งข้อความบัตรเข้า LINE OA ซ้ำให้ ${existing.holderName}`,
        actor: 'Admin'
      });
      return sendJson(res, 200, { ok: true, order: updated, lineResult });
    }
  }

  // Public Events & Zone Quota list
  if (method === 'GET' && pathname === '/api/events') {
    return sendJson(res, 200, { ok: true, events: db.listEventsWithQuota(), promos: db.listPromoCodes() });
  }

  // Public Promo Code Validation
  if (method === 'POST' && pathname === '/api/promo/validate') {
    const body = await readJsonBody(req);
    const result = db.validatePromoCode(body.code, body.subtotal);
    return sendJson(res, 200, result);
  }

  // Real-time Seat Hold Engine (10-minute Lock, Race Condition Protection & Live SSE Stream)
  if (method === 'GET' && pathname === '/api/seats/stream') {
    const sessionId = url.searchParams.get('sessionId') || '';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    const client = { res, sessionId };
    sseSeatClients.add(client);

    const initialPayload = {
      ...db.getSeatStatuses(sessionId),
      reason: 'connected',
      timestamp: Date.now()
    };
    res.write(`event: seat_sync\ndata: ${JSON.stringify(initialPayload)}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 15000);
    if (typeof keepAlive.unref === 'function') keepAlive.unref();

    req.on('close', () => {
      clearInterval(keepAlive);
      sseSeatClients.delete(client);
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/seats/status') {
    const sessionId = url.searchParams.get('sessionId') || '';
    return sendJson(res, 200, db.getSeatStatuses(sessionId));
  }

  if (method === 'POST' && pathname === '/api/seats/hold') {
    const body = await readJsonBody(req);
    const result = db.holdSeats(body.seats, body.sessionId, body.durationMs || 600000);
    if (result && result.ok) {
      broadcastSeatSync('hold');
    }
    return sendJson(res, 200, result);
  }

  if (method === 'POST' && pathname === '/api/seats/release') {
    const body = await readJsonBody(req);
    const result = db.releaseSeats(body.seats, body.sessionId);
    if (result && result.ok) {
      broadcastSeatSync('release');
    }
    return sendJson(res, 200, result);
  }

  // Admin Event & Zone Quota Manager
  if (method === 'POST' && pathname === '/api/admin/events') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const body = await readJsonBody(req);
    if (!body.title || !body.date || !body.venue) {
      return sendJson(res, 200, { ok: false, error: 'กรุณากรอกชื่อคอนเสิร์ต วันที่ และสถานที่จัดงานให้ครบถ้วน' });
    }
    const events = db.saveEvent(body);
    db.addAuditLog({
      action: body.id ? 'UPDATE_EVENT' : 'CREATE_EVENT',
      targetRef: `EVENT#${body.id || 'NEW'}`,
      detail: `${body.id ? 'แก้ไข' : 'เพิ่ม'}รอบการแสดง "${body.title}" (VIP:${body.quotaVip || 50}, A:${body.quotaA || 100}, B:${body.quotaB || 120}, C:${body.quotaC || 150})`,
      actor: 'Admin'
    });
    return sendJson(res, 200, { ok: true, events });
  }

  // Admin Delete Event
  const eventDeleteMatch = pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (
    (method === 'POST' && pathname === '/api/admin/events/delete') ||
    (method === 'DELETE' && eventDeleteMatch)
  ) {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    if (!isFullAdmin(req)) {
      return sendJson(res, 200, {
        ok: false,
        forbidden: true,
        error: 'สิทธิ์เจ้าหน้าที่จุดตรวจบัตรไม่สามารถลบรอบการแสดงได้'
      });
    }
    const body = method === 'POST' ? await readJsonBody(req) : {};
    const targetId = eventDeleteMatch ? Number(eventDeleteMatch[1]) : Number(body.id);
    const result = db.deleteEvent(targetId);
    if (!result.ok) {
      return sendJson(res, 200, { ok: false, error: result.error || 'ลบคอนเสิร์ตไม่สำเร็จ' });
    }
    db.addAuditLog({
      action: 'DELETE_EVENT',
      targetRef: `EVENT#${targetId}`,
      detail: `ลบรอบการแสดง "${result.deletedTitle}" (#${targetId}) ออกจากระบบ`,
      actor: 'Admin'
    });
    return sendJson(res, 200, result);
  }


  // Admin 1-Click Database Backup JSON
  if (method === 'GET' && pathname === '/api/admin/backup.json') {
    if (!isAdminAuthenticated(req)) {
      res.writeHead(302, { Location: '/admin.html' });
      return res.end();
    }
    const snapshot = db.exportBackupSnapshot();
    db.addAuditLog({
      action: 'DB_BACKUP',
      detail: `ดาวน์โหลดไฟล์สำรองฐานข้อมูล (คำสั่งซื้อ ${snapshot.orders.length} รายการ, คอนเสิร์ต ${snapshot.events.length} รายการ)`,
      actor: 'Admin'
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="thaiticket-backup.json"',
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(snapshot, null, 2));
  }

  // Admin 1-Click Database Restore JSON
  if (method === 'POST' && pathname === '/api/admin/restore') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const body = await readJsonBody(req);
    const snapshot = body.snapshot || body;
    db.restoreBackupSnapshot(snapshot);
    db.addAuditLog({
      action: 'DB_RESTORE',
      detail: `กู้คืนฐานข้อมูลจากไฟล์สำรองเรียบร้อยแล้ว`,
      actor: 'Admin'
    });
    return sendJson(res, 200, { ok: true, message: 'กู้คืนข้อมูลฐานข้อมูลสำเร็จ' });
  }

  // Admin Audit Logs
  if (method === 'GET' && pathname === '/api/admin/audit-logs') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    return sendJson(res, 200, { ok: true, logs: db.listAuditLogs(100) });
  }

  // Admin stats
  if (method === 'GET' && pathname === '/api/admin/stats') {
    const role = getAuthRole(req);
    if (!role) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const stats = db.getStats();
    if (role === 'gate_staff') {
      return sendJson(res, 200, { ok: true, ...stats, revenue: 0, revenueHidden: true, role });
    }
    return sendJson(res, 200, { ok: true, ...stats, role });
  }

  // Promoter Analytics Dashboard & Zone Occupancy Heatmap
  if (method === 'GET' && pathname === '/api/admin/analytics') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    return sendJson(res, 200, db.getPromoterAnalytics());
  }

  // Admin CSV Export
  if (method === 'GET' && pathname === '/api/admin/export.csv') {
    if (!isAdminAuthenticated(req)) {
      res.writeHead(302, { Location: '/admin.html' });
      return res.end();
    }
    const orders = db.listOrders({ includeSlipData: false });
    const csv = buildCsv(orders);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="thaiticket-orders.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  // Admin Guest List CSV Export (for on-site gate check-in & citizen ID verification)
  if (method === 'GET' && (pathname === '/api/admin/guest-list.csv' || pathname === '/api/admin/export-attendance' || pathname === '/api/admin/attendance.csv')) {
    if (!isAdminAuthenticated(req)) {
      res.writeHead(302, { Location: '/admin.html' });
      return res.end();
    }
    const filterStatus = url.searchParams.get('status') || 'approved';
    const checkedInOnly = url.searchParams.get('checkedInOnly') === 'true' || url.searchParams.get('checkedIn') === 'true';
    let orders = db.listOrders({ includeSlipData: false });
    if (filterStatus && filterStatus !== 'all') {
      orders = orders.filter((o) => o.status === filterStatus);
    }
    if (checkedInOnly) {
      orders = orders.filter((o) => o.checkedInAt > 0);
    }
    const csv = buildGuestListCsv(orders);
    const dateStr = new Date().toISOString().slice(0, 10);
    const isGuestList = pathname === '/api/admin/guest-list.csv';
    const fileLabel = isGuestList ? 'guest-list' : (checkedInOnly ? 'attendance-checkedin' : 'attendance-roster');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="thaiticket-${fileLabel}-${dateStr}.csv"`,
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  // Settings (LINE OA Channel Access Token + PromptPay ID + Merchant Name + Admin PIN + Gate Staff PIN + Google Drive + Slip Verifier)
  if (pathname === '/api/settings') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    if (method === 'GET') {
      const token = db.getSetting('line_channel_access_token', '');
      const promptpayId = db.getSetting('promptpay_id', '0954654698');
      const merchantName = db.getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.');
      const bankAccount = db.getSetting('bank_account', '');
      const bankName = db.getSetting('bank_name', '');
      const googleDriveFolderId = db.getSetting('google_drive_folder_id', process.env.GOOGLE_DRIVE_FOLDER_ID || '');
      const googleServiceAccountEmail = db.getSetting('google_service_account_email', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '');
      const hasGooglePrivateKey = Boolean(db.getSetting('google_service_account_private_key', process.env.GOOGLE_PRIVATE_KEY || ''));
      const slipVerifyProvider = db.getSetting('slip_verify_provider', process.env.SLIP_VERIFY_PROVIDER || 'simulator');
      const slipVerifyApiKey = db.getSetting('slip_verify_api_key', process.env.SLIP_VERIFY_API_KEY || '');
      const slipVerifyBranchId = db.getSetting('slip_verify_branch_id', process.env.SLIP_VERIFY_BRANCH_ID || '');
      const slipAutoApproveEnabled = db.getSetting('slip_auto_approve_enabled', 'false') === 'true';

      return sendJson(res, 200, {
        ok: true,
        hasLineToken: Boolean(token),
        lineTokenMasked: maskToken(token),
        promptpayId,
        merchantName,
        bankAccount,
        bankName,
        googleDriveFolderId,
        googleServiceAccountEmail,
        hasGooglePrivateKey,
        slipVerifyProvider,
        slipVerifyApiKeyMasked: maskToken(slipVerifyApiKey),
        slipVerifyBranchId,
        slipAutoApproveEnabled,
        adminLineUserId: db.getSetting('admin_line_user_id', process.env.ADMIN_LINE_USER_ID || ''),
        hasGateStaffPin: Boolean(db.getSetting('gate_staff_pin', '888888'))
      });
    }
    if (method === 'PUT') {
      if (!isFullAdmin(req)) {
        return sendJson(res, 200, {
          ok: false,
          forbidden: true,
          error: 'เฉพาะแอดมินหลักเท่านั้นที่สามารถแก้ไขการตั้งค่าระบบได้'
        });
      }
      const body = await readJsonBody(req);
      const changes = [];
      if (typeof body.lineChannelAccessToken === 'string' && body.lineChannelAccessToken.trim()) {
        db.setSetting('line_channel_access_token', body.lineChannelAccessToken.trim());
        changes.push('อัปเดต LINE Channel Access Token');
      }
      if (typeof body.promptpayId === 'string') {
        const cleanDigits = body.promptpayId.replace(/\D/g, '');
        if (cleanDigits.length === 10 || cleanDigits.length === 13) {
          db.setSetting('promptpay_id', cleanDigits);
          changes.push(`ตั้งค่าเบอร์พร้อมเพย์เป็น ${cleanDigits}`);
        } else if (body.promptpayId.trim()) {
          return sendJson(res, 200, {
            ok: false,
            error: 'เบอร์พร้อมเพย์ต้องเป็นตัวเลข 10 หลัก หรือเลขประจำตัว 13 หลัก'
          });
        }
      }
      if (typeof body.merchantName === 'string' && body.merchantName.trim()) {
        db.setSetting('merchant_name', body.merchantName.trim());
        changes.push(`ตั้งชื่อบัญชีรับเงินเป็น "${body.merchantName.trim()}"`);
      }
      if (typeof body.bankAccount === 'string') {
        db.setSetting('bank_account', body.bankAccount.trim());
        changes.push(`ตั้งค่าเลขที่บัญชีธนาคารเป็น "${body.bankAccount.trim()}"`);
      }
      if (typeof body.bankName === 'string') {
        db.setSetting('bank_name', body.bankName.trim());
        changes.push(`ตั้งค่าธนาคารเป็น "${body.bankName.trim()}"`);
      }
      if (typeof body.googleDriveFolderId === 'string') {
        db.setSetting('google_drive_folder_id', body.googleDriveFolderId.trim());
        changes.push('อัปเดต Google Drive Folder ID');
      }
      if (typeof body.googleServiceAccountEmail === 'string') {
        db.setSetting('google_service_account_email', body.googleServiceAccountEmail.trim());
        changes.push('อัปเดต Google Service Account Email');
      }
      if (typeof body.googleServiceAccountPrivateKey === 'string' && body.googleServiceAccountPrivateKey.trim()) {
        db.setSetting('google_service_account_private_key', body.googleServiceAccountPrivateKey.trim());
        changes.push('อัปเดต Google Service Account Private Key');
      }
      if (typeof body.slipVerifyProvider === 'string') {
        db.setSetting('slip_verify_provider', body.slipVerifyProvider.trim());
        changes.push(`ตั้งค่าผู้ให้บริการตรวจสลิปเป็น ${body.slipVerifyProvider.trim()}`);
      }
      if (typeof body.slipVerifyApiKey === 'string' && body.slipVerifyApiKey.trim()) {
        db.setSetting('slip_verify_api_key', body.slipVerifyApiKey.trim());
        changes.push('อัปเดต Slip Verification API Key');
      }
      if (typeof body.slipVerifyBranchId === 'string') {
        db.setSetting('slip_verify_branch_id', body.slipVerifyBranchId.trim());
        changes.push('อัปเดต Slip Verification Branch ID');
      }
      if (typeof body.slipAutoApproveEnabled === 'boolean' || typeof body.slipAutoApproveEnabled === 'string') {
        const val = String(body.slipAutoApproveEnabled) === 'true';
        db.setSetting('slip_auto_approve_enabled', val ? 'true' : 'false');
        changes.push(`ระบบอนุมัติและส่งบัตรอัตโนมัติ: ${val ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
      }
      if (typeof body.adminLineUserId === 'string') {
        db.setSetting('admin_line_user_id', body.adminLineUserId.trim());
        changes.push(`ตั้งค่า Admin LINE User ID เป็น "${body.adminLineUserId.trim()}"`);
      }
      if (typeof body.adminPin === 'string' && body.adminPin.trim().length >= 4) {
        db.setSetting('admin_pin', body.adminPin.trim());
        changes.push('เปลี่ยนรหัส PIN แอดมิน');
      }
      if (typeof body.gateStaffPin === 'string' && body.gateStaffPin.trim().length >= 4) {
        db.setSetting('gate_staff_pin', body.gateStaffPin.trim());
        changes.push('เปลี่ยนรหัส PIN เจ้าหน้าที่หน้าประตู (Gate Staff PIN)');
      }
      if (changes.length) {
        db.addAuditLog({
          action: 'UPDATE_SETTINGS',
          detail: changes.join(' · '),
          actor: 'Admin'
        });
      }
      const token = db.getSetting('line_channel_access_token', '');
      return sendJson(res, 200, {
        ok: true,
        hasLineToken: Boolean(token),
        lineTokenMasked: maskToken(token),
        promptpayId: db.getSetting('promptpay_id', '0954654698'),
        merchantName: db.getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.'),
        bankAccount: db.getSetting('bank_account', ''),
        bankName: db.getSetting('bank_name', ''),
        googleDriveFolderId: db.getSetting('google_drive_folder_id', ''),
        googleServiceAccountEmail: db.getSetting('google_service_account_email', ''),
        hasGooglePrivateKey: Boolean(db.getSetting('google_service_account_private_key', '')),
        slipVerifyProvider: db.getSetting('slip_verify_provider', 'simulator'),
        slipVerifyBranchId: db.getSetting('slip_verify_branch_id', ''),
        slipAutoApproveEnabled: db.getSetting('slip_auto_approve_enabled', 'false') === 'true'
      });
    }
  }

  // Admin Google Drive Connection Test
  if (pathname === '/api/admin/drive/test' && method === 'POST') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const body = await readJsonBody(req);
    const folderId = (body.googleDriveFolderId || db.getSetting('google_drive_folder_id', '')).trim();
    const clientEmail = (body.googleServiceAccountEmail || db.getSetting('google_service_account_email', '')).trim();
    const privateKey = (body.googleServiceAccountPrivateKey || db.getSetting('google_service_account_private_key', '')).trim();
    const testRes = await drive.testDriveConnection({ folderId, clientEmail, privateKey });
    return sendJson(res, 200, testRes);
  }

  // Admin Slip Verification Test
  if (pathname === '/api/admin/slip/test' && method === 'POST') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const body = await readJsonBody(req);
    const testOrder = { ref: 'TEST-VERIFY', total: Number(body.amount || 3600) };
    const verifyRes = await slipVerifier.verifySlip({
      order: testOrder,
      slipDataUrl: body.slipData
    });
    return sendJson(res, 200, { ok: true, result: verifyRes });
  }

  // Admin Test Instant LINE Alert
  if (pathname === '/api/admin/line/test-admin-alert' && method === 'POST') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const token = db.getSetting('line_channel_access_token', process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
    const adminLineId = (body.adminLineUserId || db.getSetting('admin_line_user_id', process.env.ADMIN_LINE_USER_ID || '')).trim();
    if (!token) {
      return sendJson(res, 200, { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE Channel Access Token ในระบบ' });
    }
    if (!adminLineId) {
      return sendJson(res, 200, { ok: false, error: 'กรุณากรอก LINE User ID ของแอดมินก่อนทดสอบ' });
    }
    const sampleOrder = {
      ref: 'TT-TEST-ALERT',
      title: 'ทดสอบระบบแจ้งเตือนแอดมิน (Thai Ticket)',
      holderName: 'คุณแอดมิน (ทดสอบ)',
      holderPhone: '095-465-4698',
      zone: 'VIP Standing',
      qty: 1,
      total: 3500
    };
    const alertRes = await sendAdminNewOrderNotification(token, adminLineId, sampleOrder);
    return sendJson(res, 200, alertRes);
  }

  return sendJson(res, 404, { error: 'ไม่พบ API ที่เรียกใช้งาน' });
}

function serveStatic(req, res, url) {
  let reqPath = decodeURIComponent(url.pathname);
  if (reqPath === '/') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', code: err.code });
  }
}

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Thai Ticket Server running at http://localhost:${PORT}`);
  });
}

module.exports = requestHandler;
module.exports.server = server;
module.exports.requestHandler = requestHandler;
module.exports.resetRateLimitsForTest = resetRateLimitsForTest;
module.exports.buildCsv = buildCsv;
module.exports.buildGuestListCsv = buildGuestListCsv;
