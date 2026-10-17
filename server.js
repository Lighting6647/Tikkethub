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
const { sendLineTicketPush, replyLineWebhook } = require('./backend/line');

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
  '.ico': 'image/x-icon'
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

// Admin Session Token (HMAC-SHA256)
function createAdminToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
  const payload = `admin.${exp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('hex');
  return parts[2] === expected;
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

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req);
  if (verifyAdminToken(cookies.tt_admin_session)) return true;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return verifyAdminToken(auth.slice(7).trim());
  }
  return false;
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

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress || '127.0.0.1';

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  // Public payment config for customer checkout QR
  if (method === 'GET' && pathname === '/api/payment-config') {
    const promptpayId = db.getSetting('promptpay_id', '0954654698');
    const merchantName = db.getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.');
    return sendJson(res, 200, {
      ok: true,
      promptpayId,
      merchantName
    });
  }

  // Admin Login / Logout / Session check
  if (pathname === '/api/admin/session' && method === 'GET') {
    return sendJson(res, 200, { authenticated: isAdminAuthenticated(req) });
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
    const expectedPin = db.getSetting('admin_pin', '123456');
    if (pin !== expectedPin) {
      db.addAuditLog({
        action: 'LOGIN_FAILED',
        detail: `พยายามเข้าสู่ระบบด้วยรหัส PIN ไม่ถูกต้อง (IP: ${ip})`,
        actor: 'System'
      });
      return sendJson(res, 200, {
        ok: false,
        error: 'รหัสผ่านแอดมิน (PIN) ไม่ถูกต้อง'
      });
    }
    db.addAuditLog({
      action: 'ADMIN_LOGIN',
      detail: `เข้าสู่ระบบจัดการแอดมินสำเร็จ (IP: ${ip})`,
      actor: 'Admin'
    });
    const token = createAdminToken();
    return sendJson(
      res,
      200,
      { ok: true, token },
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

  // Gate Check-in Scanner API
  if (method === 'POST' && pathname === '/api/checkin') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true, message: 'กรุณาเข้าสู่ระบบแอดมิน/สตาฟก่อนสแกนบัตร' });
    }
    const body = await readJsonBody(req);
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

  // Single order operations
  const orderMatch = pathname.match(/^\/api\/orders\/([A-Z0-9-]+)(?:\/(approve|reject|send-line))?$/);
  if (orderMatch) {
    const ref = orderMatch[1];
    const action = orderMatch[2];
    const existing = db.getOrder(ref);
    if (!existing) {
      return sendJson(res, 404, { error: 'ไม่พบรายการจองนี้ในระบบ' });
    }

    if (method === 'GET' && !action) {
      return sendJson(res, 200, { order: existing });
    }

    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true, error: 'กรุณาเข้าสู่ระบบแอดมินก่อนดำเนินการ' });
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
      const body = await readJsonBody(req);
      const reason = String(body.reason || 'สลิปไม่ถูกต้องหรือยอดเงินไม่ตรง').trim();
      const updated = db.updateOrderStatus(ref, {
        status: 'rejected',
        rejectReason: reason,
        lineSent: 0,
        lineLog: null
      });
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

  // Real-time Seat Hold Engine (10-minute Lock & Race Condition Protection)
  if (method === 'GET' && pathname === '/api/seats/status') {
    const sessionId = url.searchParams.get('sessionId') || '';
    return sendJson(res, 200, db.getSeatStatuses(sessionId));
  }

  if (method === 'POST' && pathname === '/api/seats/hold') {
    const body = await readJsonBody(req);
    const result = db.holdSeats(body.seats, body.sessionId, body.durationMs || 600000);
    return sendJson(res, 200, result);
  }

  if (method === 'POST' && pathname === '/api/seats/release') {
    const body = await readJsonBody(req);
    const result = db.releaseSeats(body.seats, body.sessionId);
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
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    return sendJson(res, 200, { ok: true, ...db.getStats() });
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

  // Settings (LINE OA Channel Access Token + PromptPay ID + Merchant Name + Admin PIN)
  if (pathname === '/api/settings') {
    if (!isAdminAuthenticated(req)) {
      return sendJson(res, 200, { ok: false, unauthorized: true });
    }
    if (method === 'GET') {
      const token = db.getSetting('line_channel_access_token', '');
      const promptpayId = db.getSetting('promptpay_id', '0954654698');
      const merchantName = db.getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.');
      return sendJson(res, 200, {
        ok: true,
        hasLineToken: Boolean(token),
        lineTokenMasked: maskToken(token),
        promptpayId,
        merchantName
      });
    }
    if (method === 'PUT') {
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
      if (typeof body.adminPin === 'string' && body.adminPin.trim().length >= 4) {
        db.setSetting('admin_pin', body.adminPin.trim());
        changes.push('เปลี่ยนรหัส PIN แอดมิน');
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
        merchantName: db.getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.')
      });
    }
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
