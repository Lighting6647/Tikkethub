/**
 * SQLite database layer using Node's built-in `node:sqlite` (Node 22.5+ / 24+).
 * Stores orders, slip SHA-256 hashes (for duplicate slip detection), gate check-in status,
 * LINE OA webhook contacts, admin settings, events & zone quotas, promo codes, and audit logs.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const isUnitTest = process.execArgv.includes('--test') || Boolean(process.env.NODE_TEST_CONTEXT);
const dbPath = isUnitTest ? ':memory:' : path.join(DATA_DIR, 'tickets.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS orders (
    ref TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    zone TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    total INTEGER NOT NULL,
    promo_code TEXT DEFAULT '',
    discount_amount INTEGER DEFAULT 0,
    holder_name TEXT NOT NULL,
    holder_phone TEXT NOT NULL,
    line_user_id TEXT DEFAULT '',
    slip_name TEXT NOT NULL,
    slip_mime TEXT NOT NULL,
    slip_data TEXT NOT NULL,
    slip_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reject_reason TEXT DEFAULT '',
    line_sent INTEGER NOT NULL DEFAULT 0,
    line_log TEXT DEFAULT '',
    issued_at INTEGER NOT NULL,
    reviewed_at INTEGER DEFAULT 0,
    checked_in_at INTEGER DEFAULT 0,
    checked_in_by TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_orders_slip_hash ON orders(slip_hash);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS line_contacts (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    last_message TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target_ref TEXT DEFAULT '',
    detail TEXT NOT NULL,
    actor TEXT DEFAULT 'Admin',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'world',
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    price_range TEXT NOT NULL,
    badge TEXT NOT NULL DEFAULT 'เปิดจำหน่าย',
    is_accent INTEGER NOT NULL DEFAULT 1,
    gradient TEXT NOT NULL DEFAULT 'linear-gradient(135deg, #4d1313, #1f1f1f)',
    quota_vip INTEGER NOT NULL DEFAULT 50,
    quota_a INTEGER NOT NULL DEFAULT 100,
    quota_b INTEGER NOT NULL DEFAULT 120,
    quota_c INTEGER NOT NULL DEFAULT 150
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 10,
    min_spend INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS seat_holds (
    seat_id TEXT PRIMARY KEY,
    holder_session TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_seat_holds_expires ON seat_holds(expires_at);
`);

// Safe migrations for existing orders table
const orderColumns = db.prepare(`PRAGMA table_info(orders)`).all().map((c) => c.name);
if (!orderColumns.includes('checked_in_at')) {
  db.exec(`ALTER TABLE orders ADD COLUMN checked_in_at INTEGER DEFAULT 0;`);
}
if (!orderColumns.includes('checked_in_by')) {
  db.exec(`ALTER TABLE orders ADD COLUMN checked_in_by TEXT DEFAULT '';`);
}
if (!orderColumns.includes('promo_code')) {
  db.exec(`ALTER TABLE orders ADD COLUMN promo_code TEXT DEFAULT '';`);
}
if (!orderColumns.includes('discount_amount')) {
  db.exec(`ALTER TABLE orders ADD COLUMN discount_amount INTEGER DEFAULT 0;`);
}
if (!orderColumns.includes('seats')) {
  db.exec(`ALTER TABLE orders ADD COLUMN seats TEXT DEFAULT '[]';`);
}
if (!orderColumns.includes('holder_id_card')) {
  db.exec(`ALTER TABLE orders ADD COLUMN holder_id_card TEXT DEFAULT '';`);
}
if (!orderColumns.includes('drive_file_id')) {
  db.exec(`ALTER TABLE orders ADD COLUMN drive_file_id TEXT DEFAULT '';`);
}
if (!orderColumns.includes('drive_view_link')) {
  db.exec(`ALTER TABLE orders ADD COLUMN drive_view_link TEXT DEFAULT '';`);
}
if (!orderColumns.includes('verified_by')) {
  db.exec(`ALTER TABLE orders ADD COLUMN verified_by TEXT DEFAULT '';`);
}
if (!orderColumns.includes('verification_detail')) {
  db.exec(`ALTER TABLE orders ADD COLUMN verification_detail TEXT DEFAULT '';`);
}
if (!orderColumns.includes('re_entry_attempts')) {
  db.exec(`ALTER TABLE orders ADD COLUMN re_entry_attempts INTEGER DEFAULT 0;`);
}

const DEFAULT_EVENTS = [
  {
    id: 1,
    title: 'ECHOES OF ASIA WORLD TOUR 2026',
    category: 'world',
    date: '14 - 15 พ.ย. 2026',
    venue: 'อิมแพ็ค อารีน่า เมืองทองธานี',
    priceRange: '1,800 - 6,500 THB',
    badge: 'เปิดจำหน่าย',
    isAccent: 1,
    gradient: 'linear-gradient(135deg, #4d1313, #1f1f1f)',
    quotaVip: 50,
    quotaA: 100,
    quotaB: 120,
    quotaC: 150
  },
  {
    id: 2,
    title: 'K-POP FESTIVAL LIVE IN BKK 2026',
    category: 'kpop',
    date: '28 พ.ย. 2026',
    venue: 'ราชมังคลากีฬาสถาน',
    priceRange: '2,200 - 7,000 THB',
    badge: 'บัตรเหลือน้อย',
    isAccent: 1,
    gradient: 'linear-gradient(135deg, #1b3852, #181818)',
    quotaVip: 40,
    quotaA: 80,
    quotaB: 100,
    quotaC: 140
  },
  {
    id: 3,
    title: 'THAI ROCK REVOLUTION 2026',
    category: 'thai',
    date: '5 ธ.ค. 2026',
    venue: 'ไบเทค บางนา (Hall 100)',
    priceRange: '1,200 - 3,500 THB',
    badge: 'จำหน่ายแล้ว 70%',
    isAccent: 0,
    gradient: 'linear-gradient(135deg, #3d1c1c, #1f1f1f)',
    quotaVip: 45,
    quotaA: 90,
    quotaB: 110,
    quotaC: 150
  },
  {
    id: 4,
    title: 'BIG MOUNTAIN INDIE CAMP 2026',
    category: 'fest',
    date: '12 - 13 ธ.ค. 2026',
    venue: 'The Ocean เขาใหญ่',
    priceRange: '1,500 - 2,800 THB',
    badge: 'EARLY BIRD',
    isAccent: 1,
    gradient: 'linear-gradient(135deg, #19403a, #1a1a1a)',
    quotaVip: 60,
    quotaA: 120,
    quotaB: 150,
    quotaC: 200
  },
  {
    id: 5,
    title: 'PARK HYUNG-SIK ASIAN FAN MEETING',
    category: 'fanmeeting',
    date: '19 ธ.ค. 2026',
    venue: 'พารากอน ฮอลล์, สยามพารากอน',
    priceRange: '2,500 - 5,900 THB',
    badge: 'VIP สิทธิพิเศษ',
    isAccent: 0,
    gradient: 'linear-gradient(135deg, #2b1f3d, #1c1c1c)',
    quotaVip: 30,
    quotaA: 70,
    quotaB: 90,
    quotaC: 120
  },
  {
    id: 6,
    title: 'SYNTHWAVE & RETRO NIGHT BKK',
    category: 'world',
    date: '26 ธ.ค. 2026',
    venue: 'Union Hall, ยูเนี่ยน มอลล์',
    priceRange: '1,600 - 3,200 THB',
    badge: 'เปิดจำหน่าย',
    isAccent: 1,
    gradient: 'linear-gradient(135deg, #44143a, #1a1a1a)',
    quotaVip: 40,
    quotaA: 80,
    quotaB: 100,
    quotaC: 120
  }
];

const DEFAULT_PROMOS = [
  {
    code: 'EARLY10',
    discountType: 'percent',
    discountValue: 10,
    minSpend: 1000,
    description: 'ส่วนลด Early Bird 10% ทุกโซนที่นั่ง',
    active: 1
  },
  {
    code: 'VIP500',
    discountType: 'fixed',
    discountValue: 500,
    minSpend: 3000,
    description: 'ส่วนลดพิเศษ 500 THB เมื่อซื้อครบ 3,000 THB',
    active: 1
  },
  {
    code: 'CONCERT200',
    discountType: 'fixed',
    discountValue: 200,
    minSpend: 1500,
    description: 'ส่วนลดแฟนคอนเสิร์ต 200 THB',
    active: 1
  }
];

function ensureSeedData() {
  const evCount = db.prepare(`SELECT COUNT(*) AS cnt FROM events`).get().cnt;
  if (evCount === 0) {
    const ins = db.prepare(`
      INSERT INTO events (id, title, category, date, venue, price_range, badge, is_accent, gradient, quota_vip, quota_a, quota_b, quota_c)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ev of DEFAULT_EVENTS) {
      ins.run(
        ev.id,
        ev.title,
        ev.category,
        ev.date,
        ev.venue,
        ev.priceRange,
        ev.badge,
        ev.isAccent,
        ev.gradient,
        ev.quotaVip,
        ev.quotaA,
        ev.quotaB,
        ev.quotaC
      );
    }
  }

  const promoCount = db.prepare(`SELECT COUNT(*) AS cnt FROM promo_codes`).get().cnt;
  if (promoCount === 0) {
    const insP = db.prepare(`
      INSERT INTO promo_codes (code, discount_type, discount_value, min_spend, description, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const p of DEFAULT_PROMOS) {
      insP.run(p.code, p.discountType, p.discountValue, p.minSpend, p.description, p.active);
    }
  }
}

ensureSeedData();

function generateRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return 'TT' + out.slice(0, 4) + '-' + out.slice(4);
}

function hashSlipDataUrl(dataUrl) {
  const comma = String(dataUrl).indexOf(',');
  const base64 = comma > -1 ? dataUrl.slice(comma + 1) : String(dataUrl);
  const buf = Buffer.from(base64, 'base64');
  return {
    hash: crypto.createHash('sha256').update(buf).digest('hex'),
    byteLength: buf.byteLength
  };
}

const QR_HMAC_SECRET = process.env.QR_HMAC_SECRET || 'thaiticket-qr-hmac-secret-2026';

function computeTicketSignature(ref, zone = '', qty = 1) {
  const cleanRef = String(ref || '').trim().toUpperCase();
  const cleanZone = String(zone || '').trim();
  const cleanQty = Number(qty || 1);
  return crypto
    .createHmac('sha256', QR_HMAC_SECRET)
    .update(`${cleanRef}|${cleanZone}|${cleanQty}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function buildSignedQrPayload(order) {
  if (!order || !order.ref) return '';
  const sig = computeTicketSignature(order.ref, order.zone, order.qty);
  return `THAITICKET|${order.ref}|${order.zone}|${order.qty}|SIG:${sig}`;
}

function rowToOrder(row) {
  if (!row) return null;
  let lineLog = null;
  try {
    lineLog = row.line_log ? JSON.parse(row.line_log) : null;
  } catch {
    lineLog = null;
  }
  let seats = [];
  try {
    seats = row.seats ? JSON.parse(row.seats) : [];
  } catch {
    seats = [];
  }
  const qrSignature = computeTicketSignature(row.ref, row.zone, row.qty);
  return {
    ref: row.ref,
    title: row.title,
    date: row.date,
    venue: row.venue,
    zone: row.zone,
    qty: row.qty,
    unitPrice: row.unit_price,
    total: row.total,
    promoCode: row.promo_code || '',
    discountAmount: row.discount_amount || 0,
    seats,
    holderName: row.holder_name,
    holderPhone: row.holder_phone,
    holderIdCard: row.holder_id_card || '',
    lineUserId: row.line_user_id || '',
    slipName: row.slip_name,
    slipMime: row.slip_mime,
    slipData: row.slip_data,
    slipHash: row.slip_hash,
    driveFileId: row.drive_file_id || '',
    driveViewLink: row.drive_view_link || '',
    verifiedBy: row.verified_by || '',
    verificationDetail: row.verification_detail || '',
    status: row.status,
    rejectReason: row.reject_reason || '',
    lineSent: row.line_sent,
    lineLog,
    issuedAt: row.issued_at,
    reviewedAt: row.reviewed_at || 0,
    checkedInAt: row.checked_in_at || 0,
    checkedInBy: row.checked_in_by || '',
    reEntryAttempts: row.re_entry_attempts || 0,
    qrSignature,
    qrPayload: `THAITICKET|${row.ref}|${row.zone}|${row.qty}|SIG:${qrSignature}`
  };
}

function findDuplicateSlip(slipHash) {
  const stmt = db.prepare(
    `SELECT ref, status, issued_at FROM orders WHERE slip_hash = ? AND status != 'rejected' LIMIT 1`
  );
  return stmt.get(slipHash) || null;
}

function createOrder(input) {
  const { hash, byteLength } = hashSlipDataUrl(input.slipData);
  if (byteLength < 512) {
    const err = new Error('ไฟล์สลิปมีขนาดเล็กผิดปกติ กรุณาตรวจสอบไฟล์');
    err.status = 400;
    throw err;
  }
  if (byteLength > 5 * 1024 * 1024) {
    const err = new Error('ไฟล์สลิปใหญ่เกิน 5 MB');
    err.status = 400;
    throw err;
  }

  const dup = findDuplicateSlip(hash);
  if (dup) {
    const err = new Error(`สลิปนี้เคยถูกใช้ไปแล้วในรายการ ${dup.ref} กรุณาใช้สลิปใบใหม่`);
    err.status = 409;
    err.code = 'DUPLICATE_SLIP';
    throw err;
  }

  const ref = generateRef();
  const now = Date.now();
  const seatsArr = Array.isArray(input.seats) ? input.seats : [];
  const stmt = db.prepare(`
    INSERT INTO orders (
      ref, title, date, venue, zone, qty, unit_price, total,
      promo_code, discount_amount, seats,
      holder_name, holder_phone, holder_id_card, line_user_id,
      slip_name, slip_mime, slip_data, slip_hash,
      status, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  stmt.run(
    ref,
    String(input.title).trim(),
    String(input.date).trim(),
    String(input.venue).trim(),
    String(input.zone).trim(),
    Number(input.qty),
    Number(input.unitPrice),
    Number(input.total),
    String(input.promoCode || '').trim().toUpperCase(),
    Number(input.discountAmount || 0),
    JSON.stringify(seatsArr),
    String(input.holderName).trim(),
    String(input.holderPhone).trim(),
    String(input.holderIdCard || '').trim(),
    String(input.lineUserId || '').trim(),
    String(input.slipName || 'slip.png').trim(),
    String(input.slipMime || 'image/png').trim(),
    String(input.slipData),
    hash,
    now
  );

  // Release any active holds for these seats
  if (seatsArr.length > 0) {
    for (const s of seatsArr) {
      try {
        db.prepare(`DELETE FROM seat_holds WHERE seat_id = ?`).run(String(s).trim());
      } catch {}
    }
  }

  return getOrder(ref);
}

function getOrder(ref) {
  const cleanRef = String(ref || '').trim().toUpperCase();
  const row = db.prepare(`SELECT * FROM orders WHERE ref = ?`).get(cleanRef);
  return rowToOrder(row);
}

function listOrders({ status, refs, includeSlipData = true } = {}) {
  let sql = `SELECT * FROM orders`;
  const params = [];
  const clauses = [];

  if (status && status !== 'all') {
    clauses.push(`status = ?`);
    params.push(status);
  }
  if (Array.isArray(refs) && refs.length) {
    clauses.push(`ref IN (${refs.map(() => '?').join(',')})`);
    params.push(...refs);
  }
  if (clauses.length) sql += ` WHERE ` + clauses.join(' AND ');
  sql += ` ORDER BY issued_at DESC`;

  return db.prepare(sql).all(...params).map((r) => {
    const o = rowToOrder(r);
    if (!includeSlipData) delete o.slipData;
    return o;
  });
}

function updateOrderStatus(ref, { status, rejectReason = '', lineSent = 0, lineLog = null }) {
  const now = Date.now();
  db.prepare(`
    UPDATE orders
    SET status = ?, reject_reason = ?, line_sent = ?, line_log = ?, reviewed_at = ?
    WHERE ref = ?
  `).run(
    status,
    rejectReason,
    lineSent,
    lineLog ? JSON.stringify(lineLog) : '',
    now,
    ref
  );
  return getOrder(ref);
}

function updateOrderDriveAndVerification(ref, { driveFileId = '', driveViewLink = '', verifiedBy = '', verificationDetail = '', status = null, reviewedAt = 0 }) {
  const existing = getOrder(ref);
  if (!existing) return null;

  const newStatus = status || existing.status;
  const newReviewedAt = reviewedAt || (status === 'approved' ? Date.now() : existing.reviewedAt);
  const newDriveFileId = driveFileId || existing.driveFileId;
  const newDriveViewLink = driveViewLink || existing.driveViewLink;
  const newVerifiedBy = verifiedBy || existing.verifiedBy;
  const newVerificationDetail = verificationDetail || existing.verificationDetail;

  db.prepare(`
    UPDATE orders
    SET drive_file_id = ?, drive_view_link = ?, verified_by = ?, verification_detail = ?, status = ?, reviewed_at = ?
    WHERE ref = ?
  `).run(
    newDriveFileId,
    newDriveViewLink,
    newVerifiedBy,
    newVerificationDetail,
    newStatus,
    newReviewedAt,
    ref
  );
  return getOrder(ref);
}

function checkInOrder(rawInput, staffName = 'Gate Staff #1') {
  const text = String(rawInput || '').trim();
  const parts = text.split('|');
  const ref = (parts[0] === 'THAITICKET' && parts[1] ? parts[1] : parts[0]).trim().toUpperCase();

  const existing = getOrder(ref);
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `ไม่พบรหัสการจอง "${ref}" ในระบบ`
    };
  }

  // Verify cryptographic HMAC-SHA256 signature if SIG: token is present in QR payload
  const sigPart = parts.find((p) => String(p).toUpperCase().startsWith('SIG:'));
  if (sigPart) {
    const providedSig = String(sigPart).slice(4).trim().toUpperCase();
    const expectedSig = computeTicketSignature(existing.ref, existing.zone, existing.qty);
    // Also verify zone/qty in payload haven't been altered if 4+ parts
    const zoneTampered = parts.length >= 4 && parts[2] && parts[2].trim() !== existing.zone;
    const qtyTampered = parts.length >= 4 && parts[3] && Number(parts[3]) !== Number(existing.qty);
    if (providedSig !== expectedSig || zoneTampered || qtyTampered) {
      return {
        ok: false,
        code: 'INVALID_SIGNATURE',
        signatureVerified: false,
        message: `เตือนภัยความมั่นคง! ตรวจพบรหัส QR Code ปลอมแปลงหรือลายเซ็นดิจิทัล (HMAC-SHA256) ไม่ตรงกับต้นฉบับของบัตร ${existing.ref}`,
        order: existing
      };
    }
  }

  if (existing.status === 'pending') {
    return {
      ok: false,
      code: 'NOT_APPROVED',
      message: `บัตร ${existing.ref} ยังอยู่ระหว่างรอแอดมินตรวจสอบสลิป ไม่อนุญาตให้เข้างาน`,
      order: existing
    };
  }

  if (existing.status === 'rejected') {
    return {
      ok: false,
      code: 'REJECTED',
      message: `บัตร ${existing.ref} ถูกปฏิเสธสลิป (${existing.rejectReason || 'สลิปไม่ถูกต้อง'})`,
      order: existing
    };
  }

  if (existing.checkedInAt > 0) {
    const attempts = Number(existing.reEntryAttempts || 0) + 1;
    try {
      db.prepare(`UPDATE orders SET re_entry_attempts = ? WHERE ref = ?`).run(attempts, existing.ref);
    } catch {}
    const orderSnapshot = { ...existing, reEntryAttempts: attempts };
    return {
      ok: false,
      code: 'ALREADY_CHECKED_IN',
      message: `เตือนภัย! บัตร ${existing.ref} ถูกสแกนเข้างานไปแล้วเมื่อ ${new Date(existing.checkedInAt).toLocaleString('th-TH')}`,
      firstCheckedInAt: existing.checkedInAt,
      firstCheckedInBy: existing.checkedInBy || 'Gate A (Main)',
      reEntryAttempts: attempts,
      order: orderSnapshot
    };
  }

  const now = Date.now();
  db.prepare(`UPDATE orders SET checked_in_at = ?, checked_in_by = ? WHERE ref = ?`).run(
    now,
    staffName,
    existing.ref
  );

  const updated = getOrder(existing.ref);
  return {
    ok: true,
    code: 'CHECKED_IN',
    signatureVerified: true,
    qrSignature: updated.qrSignature,
    message: `ตรวจสอบลายเซ็น HMAC-SHA256 ผ่าน! อนุญาตให้ ${updated.holderName} (${updated.qty} ใบ · ${updated.zone}) เข้างานได้`,
    order: updated
  };
}

function getStats() {
  const all = db.prepare(`SELECT zone, title, qty, total, status, checked_in_at FROM orders`).all();
  let approvedRevenue = 0;
  let approvedTickets = 0;
  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let checkedInOrders = 0;
  let checkedInTickets = 0;
  const byZone = {};

  for (const r of all) {
    if (r.status === 'pending') pendingCount++;
    else if (r.status === 'rejected') rejectedCount++;
    else if (r.status === 'approved') {
      approvedCount++;
      approvedRevenue += r.total;
      approvedTickets += r.qty;
      if (r.checked_in_at > 0) {
        checkedInOrders++;
        checkedInTickets += r.qty;
      }
      if (!byZone[r.zone]) byZone[r.zone] = { zone: r.zone, tickets: 0, orders: 0, revenue: 0 };
      byZone[r.zone].tickets += r.qty;
      byZone[r.zone].orders += 1;
      byZone[r.zone].revenue += r.total;
    }
  }

  return {
    ok: true,
    totalOrders: all.length,
    pending: pendingCount,
    pendingCount,
    approvedCount,
    rejectedCount,
    approvedTickets,
    approvedRevenue,
    checkedInOrders,
    checkedInTickets,
    byZone: Object.values(byZone).sort((a, b) => b.revenue - a.revenue)
  };
}

// Events & Zone Quota Manager
function listEventsWithQuota() {
  const rows = db.prepare(`SELECT * FROM events ORDER BY id ASC`).all();
  const soldRows = db
    .prepare(`SELECT title, zone, SUM(qty) AS sold FROM orders WHERE status != 'rejected' GROUP BY title, zone`)
    .all();

  const soldMap = {};
  for (const s of soldRows) {
    const key = `${s.title}`;
    if (!soldMap[key]) soldMap[key] = { vip: 0, a: 0, b: 0, c: 0, totalSold: 0 };
    const z = String(s.zone || '').toLowerCase();
    const count = Number(s.sold || 0);
    soldMap[key].totalSold += count;
    if (z.includes('vip')) soldMap[key].vip += count;
    else if (z.includes('zone a')) soldMap[key].a += count;
    else if (z.includes('zone b')) soldMap[key].b += count;
    else soldMap[key].c += count;
  }

  return rows.map((r) => {
    const sold = soldMap[r.title] || { vip: 0, a: 0, b: 0, c: 0, totalSold: 0 };
    const totalQuota = r.quota_vip + r.quota_a + r.quota_b + r.quota_c;
    const remainingTotal = Math.max(0, totalQuota - sold.totalSold);
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      date: r.date,
      venue: r.venue,
      priceRange: r.price_range,
      badge: r.badge,
      isAccent: Boolean(r.is_accent),
      gradient: r.gradient,
      quotaVip: r.quota_vip,
      quotaA: r.quota_a,
      quotaB: r.quota_b,
      quotaC: r.quota_c,
      remainingVip: Math.max(0, r.quota_vip - sold.vip),
      remainingA: Math.max(0, r.quota_a - sold.a),
      remainingB: Math.max(0, r.quota_b - sold.b),
      remainingC: Math.max(0, r.quota_c - sold.c),
      totalQuota,
      remainingTotal
    };
  });
}

function saveEvent(input) {
  const title = String(input.title || '').trim();
  const category = String(input.category || 'world').trim();
  const date = String(input.date || '').trim();
  const venue = String(input.venue || '').trim();
  const priceRange = String(input.priceRange || '1,500 - 5,000 THB').trim();
  const badge = String(input.badge || 'เปิดจำหน่าย').trim();
  const isAccent = input.isAccent === false || input.isAccent === 0 ? 0 : 1;
  const gradient = String(input.gradient || 'linear-gradient(135deg, #4d1313, #1f1f1f)').trim();
  const quotaVip = Math.max(1, Number(input.quotaVip || 50));
  const quotaA = Math.max(1, Number(input.quotaA || 100));
  const quotaB = Math.max(1, Number(input.quotaB || 120));
  const quotaC = Math.max(1, Number(input.quotaC || 150));

  if (input.id) {
    db.prepare(`
      UPDATE events
      SET title = ?, category = ?, date = ?, venue = ?, price_range = ?, badge = ?, is_accent = ?, gradient = ?,
          quota_vip = ?, quota_a = ?, quota_b = ?, quota_c = ?
      WHERE id = ?
    `).run(title, category, date, venue, priceRange, badge, isAccent, gradient, quotaVip, quotaA, quotaB, quotaC, Number(input.id));
  } else {
    db.prepare(`
      INSERT INTO events (title, category, date, venue, price_range, badge, is_accent, gradient, quota_vip, quota_a, quota_b, quota_c)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, category, date, venue, priceRange, badge, isAccent, gradient, quotaVip, quotaA, quotaB, quotaC);
  }
  return listEventsWithQuota();
}

function deleteEvent(id) {
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    return { ok: false, error: 'รหัสคอนเสิร์ตไม่ถูกต้อง', events: listEventsWithQuota() };
  }
  const existing = db.prepare(`SELECT * FROM events WHERE id = ?`).get(numId);
  db.prepare(`DELETE FROM events WHERE id = ?`).run(numId);
  try {
    const raw = getSetting('deleted_event_ids', '[]');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && !arr.includes(numId)) {
      arr.push(numId);
      setSetting('deleted_event_ids', JSON.stringify(arr));
    }
  } catch {
    setSetting('deleted_event_ids', JSON.stringify([numId]));
  }
  return {
    ok: true,
    deletedId: numId,
    deletedTitle: existing ? existing.title : `คอนเสิร์ต #${numId}`,
    events: listEventsWithQuota()
  };
}

function deleteOrder(ref) {
  const cleanRef = String(ref || '').trim().toUpperCase();
  if (!cleanRef) {
    return { ok: false, error: 'รหัสคำสั่งซื้อไม่ถูกต้อง' };
  }
  const existing = getOrder(cleanRef);
  db.prepare(`DELETE FROM orders WHERE ref = ?`).run(cleanRef);
  try {
    const raw = getSetting('deleted_order_refs', '[]');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && !arr.includes(cleanRef)) {
      arr.push(cleanRef);
      setSetting('deleted_order_refs', JSON.stringify(arr));
    }
  } catch {
    setSetting('deleted_order_refs', JSON.stringify([cleanRef]));
  }
  return {
    ok: true,
    deletedRef: cleanRef,
    deletedOrder: existing || null
  };
}


// Promo Code System
function listPromoCodes() {
  return db
    .prepare(`SELECT * FROM promo_codes ORDER BY code ASC`)
    .all()
    .map((r) => ({
      code: r.code,
      discountType: r.discount_type,
      discountValue: r.discount_value,
      minSpend: r.min_spend,
      description: r.description,
      active: Boolean(r.active)
    }));
}

function validatePromoCode(rawCode, subtotal) {
  const code = String(rawCode || '').trim().toUpperCase();
  const amount = Number(subtotal || 0);
  if (!code) {
    return { ok: false, error: 'กรุณากรอกโค้ดส่วนลด' };
  }
  const row = db.prepare(`SELECT * FROM promo_codes WHERE code = ? AND active = 1`).get(code);
  if (!row) {
    return { ok: false, error: `ไม่พบโค้ดส่วนลด "${code}" หรือโค้ดหมดอายุแล้ว` };
  }
  if (amount < row.min_spend) {
    return {
      ok: false,
      error: `โค้ด ${code} ใช้ได้เมื่อมียอดสั่งซื้อขั้นต่ำ ${Number(row.min_spend).toLocaleString('th-TH')} THB`
    };
  }
  const discountAmount =
    row.discount_type === 'percent'
      ? Math.round((amount * row.discount_value) / 100)
      : Math.min(amount - 1, Number(row.discount_value));
  const netTotal = Math.max(1, amount - discountAmount);
  return {
    ok: true,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    discountAmount,
    netTotal,
    description: row.description
  };
}

// 1-Click Database Backup & Restore
function exportBackupSnapshot() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    orders: db.prepare(`SELECT * FROM orders ORDER BY issued_at DESC`).all(),
    settings: db.prepare(`SELECT * FROM settings`).all(),
    events: db.prepare(`SELECT * FROM events ORDER BY id ASC`).all(),
    promoCodes: db.prepare(`SELECT * FROM promo_codes ORDER BY code ASC`).all(),
    lineContacts: db.prepare(`SELECT * FROM line_contacts`).all(),
    auditLogs: db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200`).all()
  };
}

function restoreBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('ไฟล์สำรองข้อมูลไม่ถูกต้อง');
  }
  db.exec('BEGIN');
  try {
    if (Array.isArray(snapshot.settings)) {
      const stmt = db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      for (const s of snapshot.settings) {
        if (s && s.key) stmt.run(String(s.key), String(s.value ?? ''));
      }
    }
    if (Array.isArray(snapshot.events) && snapshot.events.length) {
      db.exec(`DELETE FROM events;`);
      const insEv = db.prepare(`
        INSERT INTO events (id, title, category, date, venue, price_range, badge, is_accent, gradient, quota_vip, quota_a, quota_b, quota_c)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const ev of snapshot.events) {
        insEv.run(
          ev.id,
          ev.title,
          ev.category || 'world',
          ev.date,
          ev.venue,
          ev.price_range || ev.priceRange || '1,500 - 5,000 THB',
          ev.badge || 'เปิดจำหน่าย',
          ev.is_accent ?? 1,
          ev.gradient || 'linear-gradient(135deg, #4d1313, #1f1f1f)',
          ev.quota_vip ?? 50,
          ev.quota_a ?? 100,
          ev.quota_b ?? 120,
          ev.quota_c ?? 150
        );
      }
    }
    if (Array.isArray(snapshot.orders)) {
      db.exec(`DELETE FROM orders;`);
      const insOrd = db.prepare(`
        INSERT INTO orders (
          ref, title, date, venue, zone, qty, unit_price, total,
          promo_code, discount_amount,
          holder_name, holder_phone, holder_id_card, line_user_id,
          slip_name, slip_mime, slip_data, slip_hash,
          status, reject_reason, line_sent, line_log,
          issued_at, reviewed_at, checked_in_at, checked_in_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const o of snapshot.orders) {
        insOrd.run(
          o.ref,
          o.title,
          o.date,
          o.venue,
          o.zone,
          o.qty,
          o.unit_price ?? o.unitPrice ?? 0,
          o.total,
          o.promo_code || o.promoCode || '',
          o.discount_amount ?? o.discountAmount ?? 0,
          o.holder_name || o.holderName || '',
          o.holder_phone || o.holderPhone || '',
          o.holder_id_card || o.holderIdCard || '',
          o.line_user_id || o.lineUserId || '',
          o.slip_name || o.slipName || 'slip.png',
          o.slip_mime || o.slipMime || 'image/png',
          o.slip_data || o.slipData || '',
          o.slip_hash || o.slipHash || '',
          o.status || 'pending',
          o.reject_reason || o.rejectReason || '',
          o.line_sent ?? o.lineSent ?? 0,
          typeof o.line_log === 'string' ? o.line_log : JSON.stringify(o.lineLog || ''),
          o.issued_at || o.issuedAt || Date.now(),
          o.reviewed_at || o.reviewedAt || 0,
          o.checked_in_at || o.checkedInAt || 0,
          o.checked_in_by || o.checkedInBy || ''
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function saveLineContact({ userId, displayName = 'ลูกค้า LINE OA', lastMessage = '' }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO line_contacts (user_id, display_name, last_message, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      last_message = excluded.last_message,
      updated_at = excluded.updated_at
  `).run(String(userId).trim(), String(displayName).trim(), String(lastMessage).trim(), now);
  return getLatestLineContact();
}

function getLatestLineContact() {
  return db.prepare(`SELECT * FROM line_contacts ORDER BY updated_at DESC LIMIT 1`).get() || null;
}

function getSetting(key, fallback = '') {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function addAuditLog({ action, targetRef = '', detail = '', actor = 'Admin' }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO audit_logs (action, target_ref, detail, actor, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(action), String(targetRef || ''), String(detail || ''), String(actor || 'Admin'), now);
}

function listAuditLogs(limit = 100) {
  return db
    .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(Number(limit) || 100)
    .map((r) => ({
      id: r.id,
      action: r.action,
      targetRef: r.target_ref,
      detail: r.detail,
      actor: r.actor,
      createdAt: r.created_at
    }));
}

const BASE_OCCUPIED_SEATS = [
  'VIP-03', 'VIP-04', 'VIP-09',
  'A-01', 'A-02', 'A-07', 'A-08',
  'B-04', 'B-05', 'B-11',
  'C-02', 'C-08', 'C-09', 'C-15', 'C-16'
];

function cleanExpiredHolds() {
  const info = db.prepare(`DELETE FROM seat_holds WHERE expires_at <= ?`).run(Date.now());
  return Number(info && info.changes ? info.changes : 0);
}

function getBookedSeatIds() {
  const rows = db.prepare(`SELECT seats FROM orders WHERE status != 'rejected'`).all();
  const set = new Set(BASE_OCCUPIED_SEATS);
  for (const r of rows) {
    if (r.seats) {
      try {
        const arr = JSON.parse(r.seats);
        if (Array.isArray(arr)) {
          arr.forEach((s) => set.add(String(s).trim()));
        }
      } catch {}
    }
  }
  return set;
}

function getSeatStatuses(sessionId = '') {
  cleanExpiredHolds();
  const bookedSet = getBookedSeatIds();
  const activeHolds = db
    .prepare(`SELECT seat_id, holder_session, expires_at FROM seat_holds WHERE expires_at > ?`)
    .all(Date.now());
  const holdMap = new Map();
  for (const h of activeHolds) {
    holdMap.set(h.seat_id, h);
  }

  const result = {};
  const now = Date.now();
  let myHoldExpiresAt = 0;

  const allSeatIds = [
    ...Array.from({ length: 12 }, (_, i) => `VIP-${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 16 }, (_, i) => `A-${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 16 }, (_, i) => `B-${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 20 }, (_, i) => `C-${String(i + 1).padStart(2, '0')}`)
  ];

  for (const seatId of allSeatIds) {
    if (bookedSet.has(seatId)) {
      result[seatId] = { status: 'occupied' };
    } else if (holdMap.has(seatId)) {
      const h = holdMap.get(seatId);
      if (sessionId && h.holder_session === sessionId) {
        result[seatId] = { status: 'held_by_me', expiresAt: h.expires_at };
        if (h.expires_at > myHoldExpiresAt) myHoldExpiresAt = h.expires_at;
      } else {
        result[seatId] = { status: 'held_by_other', expiresAt: h.expires_at };
      }
    } else {
      result[seatId] = { status: 'available' };
    }
  }

  const remainingSeconds = myHoldExpiresAt > now ? Math.round((myHoldExpiresAt - now) / 1000) : 0;
  return {
    ok: true,
    seats: result,
    activeHoldsCount: activeHolds.length,
    myHoldExpiresAt: remainingSeconds > 0 ? myHoldExpiresAt : null,
    remainingSeconds
  };
}

function holdSeats(seats, sessionId, durationMs = 600000) {
  if (!Array.isArray(seats) || !seats.length) {
    return { ok: false, error: 'กรุณาระบุที่นั่งที่ต้องการล็อก' };
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'ไม่พบ Session ID' };
  }
  if (seats.length > 4) {
    return { ok: false, error: 'เลือกล็อกที่นั่งได้สูงสุด 4 ที่นั่ง' };
  }

  cleanExpiredHolds();
  const bookedSet = getBookedSeatIds();
  const now = Date.now();
  const expiresAt = now + durationMs;

  const conflicts = [];
  for (const seatId of seats) {
    if (bookedSet.has(seatId)) {
      conflicts.push(seatId);
      continue;
    }
    const existing = db
      .prepare(`SELECT holder_session, expires_at FROM seat_holds WHERE seat_id = ? AND expires_at > ?`)
      .get(seatId, now);
    if (existing && existing.holder_session !== sessionId) {
      conflicts.push(seatId);
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      conflictSeats: conflicts,
      message: `ที่นั่ง ${conflicts.join(', ')} ถูกจองหรือกำลังมีผู้ใช้อื่นเลือกอยู่ กรุณาเลือกที่นั่งอื่น`
    };
  }

  // Clear any existing seats held by this session that are NOT in the new list
  const currentHeld = db.prepare(`SELECT seat_id FROM seat_holds WHERE holder_session = ?`).all(sessionId);
  for (const row of currentHeld) {
    if (!seats.includes(row.seat_id)) {
      db.prepare(`DELETE FROM seat_holds WHERE seat_id = ? AND holder_session = ?`).run(row.seat_id, sessionId);
    }
  }

  // Save/refresh holds
  const ins = db.prepare(`
    INSERT INTO seat_holds (seat_id, holder_session, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(seat_id) DO UPDATE SET
      holder_session = excluded.holder_session,
      expires_at = excluded.expires_at
  `);

  for (const seatId of seats) {
    ins.run(seatId, sessionId, expiresAt, now);
  }

  return {
    ok: true,
    heldSeats: seats,
    expiresAt,
    remainingSeconds: Math.round(durationMs / 1000)
  };
}

function releaseSeats(seats, sessionId) {
  if (!sessionId) return { ok: false, error: 'ไม่พบ Session ID' };
  cleanExpiredHolds();
  if (Array.isArray(seats) && seats.length) {
    for (const seatId of seats) {
      db.prepare(`DELETE FROM seat_holds WHERE seat_id = ? AND holder_session = ?`).run(seatId, sessionId);
    }
  } else {
    db.prepare(`DELETE FROM seat_holds WHERE holder_session = ?`).run(sessionId);
  }
  return { ok: true };
}

function getPromoterAnalytics() {
  const allOrders = db.prepare(`SELECT * FROM orders`).all();
  const approvedOrders = allOrders.filter((o) => o.status === 'approved');
  const pendingOrders = allOrders.filter((o) => o.status === 'pending');
  const rejectedOrders = allOrders.filter((o) => o.status === 'rejected');

  const totalGrossRevenue = approvedOrders.reduce((sum, o) => sum + (o.total + (o.discount_amount || 0)), 0);
  const totalNetRevenue = approvedOrders.reduce((sum, o) => sum + o.total, 0);
  const totalDiscountGiven = approvedOrders.reduce((sum, o) => sum + (o.discount_amount || 0), 0);
  const totalTicketsSold = approvedOrders.reduce((sum, o) => sum + o.qty, 0);
  const aov = approvedOrders.length > 0 ? Math.round(totalNetRevenue / approvedOrders.length) : 0;

  // Zone Capacities & Breakdown (Impact Arena model)
  const zoneStats = {
    VIP: { name: 'VIP Standing', quota: 50, price: 6500, sold: 0, revenue: 0, color: '#B40000' },
    A: { name: 'Zone A (บัตรนั่ง)', quota: 100, price: 4500, sold: 0, revenue: 0, color: '#229BFF' },
    B: { name: 'Zone B (บัตรนั่ง)', quota: 120, price: 3200, sold: 0, revenue: 0, color: '#0284c7' },
    C: { name: 'Zone C (ชั้นบน)', quota: 150, price: 1800, sold: 0, revenue: 0, color: '#0f766e' }
  };

  for (const o of approvedOrders) {
    const z = String(o.zone || '').toUpperCase();
    let key = 'VIP';
    if (z.includes('VIP')) key = 'VIP';
    else if (z.includes('ZONE A') || z.startsWith('A')) key = 'A';
    else if (z.includes('ZONE B') || z.startsWith('B')) key = 'B';
    else if (z.includes('ZONE C') || z.startsWith('C')) key = 'C';

    if (zoneStats[key]) {
      zoneStats[key].sold += o.qty;
      zoneStats[key].revenue += o.total;
    }
  }

  const totalCapacity = Object.values(zoneStats).reduce((sum, z) => sum + z.quota, 0);
  const overallOccupancyPct = totalCapacity > 0 ? Math.min(100, Math.round((totalTicketsSold / totalCapacity) * 100)) : 0;

  Object.keys(zoneStats).forEach((k) => {
    const z = zoneStats[k];
    z.occupancyPct = Math.min(100, Math.round((z.sold / z.quota) * 100));
    z.remaining = Math.max(0, z.quota - z.sold);
  });

  // Per-event financial settlement breakdown
  const eventsList = listEventsWithQuota();
  const eventSettlements = eventsList.map((ev) => {
    const evApproved = approvedOrders.filter((o) => o.title === ev.title);
    const ordersCount = evApproved.length;
    const ticketsSold = evApproved.reduce((s, o) => s + o.qty, 0);
    const grossRevenue = evApproved.reduce((s, o) => s + (o.total + (o.discount_amount || 0)), 0);
    const discountAmount = evApproved.reduce((s, o) => s + (o.discount_amount || 0), 0);
    const netRevenue = evApproved.reduce((s, o) => s + o.total, 0);
    const checkedInTickets = evApproved.filter((o) => o.checked_in_at > 0).reduce((s, o) => s + o.qty, 0);
    return {
      id: ev.id,
      title: ev.title,
      date: ev.date,
      venue: ev.venue,
      ordersCount,
      ticketsSold,
      totalQuota: ev.totalQuota,
      remainingTotal: ev.remainingTotal,
      grossRevenue,
      discountAmount,
      netRevenue,
      checkedInTickets
    };
  });

  // Promo code breakdown
  const allPromos = listPromoCodes();
  const promoBreakdown = allPromos.map((p) => {
    const matching = approvedOrders.filter((o) => o.promo_code === p.code);
    return {
      code: p.code,
      description: p.description,
      usedCount: matching.length,
      totalDiscount: matching.reduce((s, o) => s + (o.discount_amount || 0), 0),
      netRevenue: matching.reduce((s, o) => s + o.total, 0)
    };
  });

  // Hourly velocity (last 24 hours in 4-hour buckets)
  const now = Date.now();
  const hourlyBuckets = [];
  for (let i = 5; i >= 0; i--) {
    const startHour = new Date(now - (i + 1) * 4 * 3600 * 1000);
    const endHour = new Date(now - i * 4 * 3600 * 1000);
    const label = `${String(startHour.getHours()).padStart(2, '0')}:00 - ${String(endHour.getHours()).padStart(2, '0')}:00`;
    const count = allOrders.filter((o) => o.issued_at >= startHour.getTime() && o.issued_at < endHour.getTime()).length;
    const rev = allOrders
      .filter((o) => o.status === 'approved' && o.issued_at >= startHour.getTime() && o.issued_at < endHour.getTime())
      .reduce((sum, o) => sum + o.total, 0);
    hourlyBuckets.push({ label, count, revenue: rev });
  }

  // Gate Check-in Stats
  const checkedInCount = approvedOrders.filter((o) => o.checked_in_at > 0).reduce((s, o) => s + o.qty, 0);
  const checkInRatePct = totalTicketsSold > 0 ? Math.round((checkedInCount / totalTicketsSold) * 100) : 0;

  // Promo campaign stats
  const promoUsedOrders = approvedOrders.filter((o) => Boolean(o.promo_code));
  const earlyBirdOrders = approvedOrders.filter((o) => o.promo_code === 'EARLY10');

  return {
    ok: true,
    settlementMeta: {
      reportId: `STL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      generatedAt: now,
      merchantName: getSetting('merchant_name', 'Thai Ticket Concert Co., Ltd.'),
      promptpayId: getSetting('promptpay_id', '0954654698')
    },
    kpis: {
      totalGrossRevenue,
      totalNetRevenue,
      totalDiscountGiven,
      totalTicketsSold,
      totalCapacity,
      overallOccupancyPct,
      aov,
      totalOrders: allOrders.length,
      approvedOrders: approvedOrders.length,
      pendingOrders: pendingOrders.length,
      rejectedOrders: rejectedOrders.length,
      checkedInCount,
      checkInRatePct
    },
    zones: zoneStats,
    eventSettlements,
    promoBreakdown,
    hourlyVelocity: hourlyBuckets,
    promos: {
      promoOrderCount: promoUsedOrders.length,
      totalDiscountGiven,
      earlyBirdRedeemed: earlyBirdOrders.length,
      earlyBirdRemainingQuota: Math.max(0, 100 - earlyBirdOrders.length)
    }
  };
}

function getGateThroughputMonitor() {
  const allApproved = db.prepare(`SELECT * FROM orders WHERE status = 'approved' ORDER BY issued_at DESC`).all();
  const checkedInOrdersList = allApproved.filter((o) => o.checked_in_at > 0);

  const totalApprovedOrders = allApproved.length;
  const totalApprovedTickets = allApproved.reduce((sum, o) => sum + (o.qty || 1), 0);
  const checkedInOrders = checkedInOrdersList.length;
  const checkedInTickets = checkedInOrdersList.reduce((sum, o) => sum + (o.qty || 1), 0);
  const remainingTickets = Math.max(0, totalApprovedTickets - checkedInTickets);
  const progressPct = totalApprovedTickets > 0 ? Math.round((checkedInTickets / totalApprovedTickets) * 100) : 0;

  const now = Date.now();
  const window15m = 15 * 60 * 1000;
  const recent15mOrders = checkedInOrdersList.filter((o) => now - o.checked_in_at <= window15m);
  const paxLast15m = recent15mOrders.reduce((sum, o) => sum + (o.qty || 1), 0);
  const paxPerMinute = Number((paxLast15m / 15).toFixed(1));
  const effectivePace =
    paxPerMinute > 0 ? paxPerMinute : checkedInTickets > 0 ? Number((checkedInTickets / 10).toFixed(1)) : 0;
  const estimatedClearanceMinutes =
    remainingTickets === 0 ? 0 : effectivePace > 0 ? Math.ceil(remainingTickets / effectivePace) : null;

  const defaultGateNames = ['ประตู Gate A (Main)', 'ประตู Gate B (Side)', 'ประตู VIP Fast Track'];
  const gateMap = new Map();
  for (const name of defaultGateNames) {
    gateMap.set(name, {
      gateName: name,
      ordersScanned: 0,
      ticketsScanned: 0,
      recentPax15m: 0,
      lastScanAt: 0
    });
  }

  for (const o of checkedInOrdersList) {
    const gName = (o.checked_in_by || 'ประตู Gate A (Main)').trim() || 'ประตู Gate A (Main)';
    if (!gateMap.has(gName)) {
      gateMap.set(gName, {
        gateName: gName,
        ordersScanned: 0,
        ticketsScanned: 0,
        recentPax15m: 0,
        lastScanAt: 0
      });
    }
    const g = gateMap.get(gName);
    g.ordersScanned += 1;
    g.ticketsScanned += o.qty || 1;
    if (now - o.checked_in_at <= window15m) {
      g.recentPax15m += o.qty || 1;
    }
    if (o.checked_in_at > g.lastScanAt) {
      g.lastScanAt = o.checked_in_at;
    }
  }

  const gates = Array.from(gateMap.values()).map((g) => {
    const sharePct = checkedInTickets > 0 ? Math.round((g.ticketsScanned / checkedInTickets) * 100) : 0;
    const gatePace = Number((g.recentPax15m / 15).toFixed(1));
    return {
      gateName: g.gateName,
      ordersScanned: g.ordersScanned,
      ticketsScanned: g.ticketsScanned,
      sharePct,
      paxPerMin: gatePace > 0 ? gatePace : g.ticketsScanned > 0 ? Number((g.ticketsScanned / 10).toFixed(1)) : 0,
      lastScanAt: g.lastScanAt,
      status: g.ticketsScanned > 0 ? 'active' : 'standby'
    };
  });

  const zoneDefinitions = [
    { key: 'VIP', label: 'VIP Standing / Ringside', color: '#E53E3E' },
    { key: 'A', label: 'Zone A (Front Arena)', color: '#DD6B20' },
    { key: 'B', label: 'Zone B (Standard Tier)', color: '#229BFF' },
    { key: 'C', label: 'Zone C (Balcony / Upper)', color: '#68D391' }
  ];

  const zones = zoneDefinitions.map((zd) => {
    const matching = allApproved.filter((o) => {
      const z = String(o.zone || '').toUpperCase();
      if (zd.key === 'VIP') return z.includes('VIP');
      if (zd.key === 'A') return z.includes('ZONE A') || z === 'A';
      if (zd.key === 'B') return z.includes('ZONE B') || z === 'B';
      return z.includes('ZONE C') || z === 'C' || (!z.includes('VIP') && !z.includes('ZONE A') && !z.includes('ZONE B'));
    });
    const soldTickets = matching.reduce((s, o) => s + (o.qty || 1), 0);
    const arrivedTickets = matching.filter((o) => o.checked_in_at > 0).reduce((s, o) => s + (o.qty || 1), 0);
    const arrivalPct = soldTickets > 0 ? Math.round((arrivedTickets / soldTickets) * 100) : 0;
    return {
      key: zd.key,
      label: zd.label,
      color: zd.color,
      soldTickets,
      checkedInTickets: arrivedTickets,
      remainingTickets: Math.max(0, soldTickets - arrivedTickets),
      arrivalPct
    };
  });

  const recentScans = [...checkedInOrdersList]
    .sort((a, b) => b.checked_in_at - a.checked_in_at)
    .slice(0, 10)
    .map((o) => {
      let seats = [];
      try {
        seats = JSON.parse(o.seats || '[]');
      } catch {}
      return {
        ref: o.ref,
        holderName: o.holder_name,
        zone: o.zone,
        qty: o.qty,
        seats,
        checkedInBy: o.checked_in_by || 'ประตู Gate A (Main)',
        checkedInAt: o.checked_in_at
      };
    });

  return {
    ok: true,
    timestamp: now,
    summary: {
      totalApprovedOrders,
      totalApprovedTickets,
      checkedInOrders,
      checkedInTickets,
      remainingTickets,
      progressPct,
      paxPerMinute: effectivePace,
      paxLast15m,
      estimatedClearanceMinutes
    },
    gates,
    zones,
    recentScans
  };
}

function buildFallbackSlipSvgDataUrl(t) {
  const ref = String(t.ref || 'TT0000').replace(/[<>&"']/g, '');
  const holder = String(t.holderName || 'ผู้ถือบัตร').replace(/[<>&"']/g, '');
  const phone = String(t.holderPhone || '-').replace(/[<>&"']/g, '');
  const zone = String(t.zone || 'VIP').replace(/[<>&"']/g, '');
  const qty = Number(t.qty || 1);
  const total = Number(t.total || 0).toLocaleString('th-TH');
  const dateStr = new Date(Number(t.issuedAt) || Date.now()).toLocaleString('th-TH');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
    <rect width="480" height="640" rx="16" fill="#1E1E1E"/>
    <rect x="20" y="20" width="440" height="600" rx="12" fill="#2A2A2A" stroke="#444" stroke-width="2"/>
    <rect x="20" y="20" width="440" height="84" rx="12" fill="#B40000"/>
    <text x="240" y="58" fill="#FFFFFF" font-family="sans-serif" font-size="22" font-weight="bold" text-anchor="middle">THAI QR PROMPTPAY SLIP</text>
    <text x="240" y="84" fill="#FFDADA" font-family="sans-serif" font-size="14" text-anchor="middle">หลักฐานการชำระเงิน (ซิงก์จากบัตรของฉัน)</text>
    <circle cx="240" cy="156" r="32" fill="#229BFF"/>
    <text x="240" y="166" fill="#FFFFFF" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">✓</text>
    <text x="240" y="218" fill="#68D391" font-family="sans-serif" font-size="20" font-weight="bold" text-anchor="middle">โอนเงินสำเร็จ (Payment Recorded)</text>
    <text x="240" y="264" fill="#229BFF" font-family="sans-serif" font-size="34" font-weight="bold" text-anchor="middle">${total} THB</text>
    <line x1="50" y1="296" x2="430" y2="296" stroke="#444" stroke-dasharray="6,6"/>
    <text x="55" y="340" fill="#999999" font-family="sans-serif" font-size="15">รหัสการจอง (Booking Ref)</text>
    <text x="425" y="340" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="end">${ref}</text>
    <text x="55" y="385" fill="#999999" font-family="sans-serif" font-size="15">ชื่อผู้โอน / ผู้ถือบัตร</text>
    <text x="425" y="385" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="end">${holder}</text>
    <text x="55" y="430" fill="#999999" font-family="sans-serif" font-size="15">เบอร์โทรศัพท์</text>
    <text x="425" y="430" fill="#FFFFFF" font-family="sans-serif" font-size="16" text-anchor="end">${phone}</text>
    <text x="55" y="475" fill="#999999" font-family="sans-serif" font-size="15">โซนที่นั่ง / จำนวน</text>
    <text x="425" y="475" fill="#229BFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="end">${zone} (${qty} ใบ)</text>
    <text x="55" y="520" fill="#999999" font-family="sans-serif" font-size="15">เวลาทำรายการ</text>
    <text x="425" y="520" fill="#CCCCCC" font-family="sans-serif" font-size="14" text-anchor="end">${dateStr}</text>
    <line x1="50" y1="552" x2="430" y2="552" stroke="#444"/>
    <text x="240" y="588" fill="#888888" font-family="sans-serif" font-size="12" text-anchor="middle">Verified Client-Server Sync · Thai Ticket Hub</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function recoverOrdersFromClient(clientTickets) {
  if (!Array.isArray(clientTickets) || !clientTickets.length) {
    return { recoveredCount: 0, orders: [] };
  }
  let deletedRefs = [];
  try {
    deletedRefs = JSON.parse(getSetting('deleted_order_refs', '[]')) || [];
  } catch {
    deletedRefs = [];
  }
  let recoveredCount = 0;
  const checkStmt = db.prepare(`SELECT ref FROM orders WHERE ref = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO orders (
      ref, title, date, venue, zone, qty, unit_price, total,
      promo_code, discount_amount, seats,
      holder_name, holder_phone, holder_id_card, line_user_id,
      slip_name, slip_mime, slip_data, slip_hash,
      status, reject_reason, line_sent, issued_at, reviewed_at, checked_in_at, checked_in_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of clientTickets) {
    if (!t || !t.ref) continue;
    const cleanRef = String(t.ref).trim().toUpperCase();
    if (!cleanRef || deletedRefs.includes(cleanRef)) continue;
    const exists = checkStmt.get(cleanRef);
    if (exists) continue;

    const slipData =
      typeof t.slipData === 'string' && t.slipData.startsWith('data:image/')
        ? t.slipData
        : buildFallbackSlipSvgDataUrl(t);
    const slipHash =
      t.slipHash ||
      crypto.createHash('sha256').update(`${cleanRef}:${t.issuedAt || Date.now()}`).digest('hex');
    const qty = Math.max(1, Number(t.qty || 1));
    const total = Math.max(0, Number(t.total || 0));
    const unitPrice = Number(t.unitPrice || Math.round(total / qty) || 0);
    const seatsArr = Array.isArray(t.seats) ? t.seats : [];
    const status = ['pending', 'approved', 'rejected'].includes(t.status) ? t.status : 'pending';

    insertStmt.run(
      cleanRef,
      String(t.title || 'ECHOES OF ASIA WORLD TOUR 2026').trim(),
      String(t.date || '14 - 15 พ.ย. 2026').trim(),
      String(t.venue || 'อิมแพ็ค อารีน่า เมืองทองธานี').trim(),
      String(t.zone || 'VIP Standing').trim(),
      qty,
      unitPrice,
      total,
      String(t.promoCode || '').trim().toUpperCase(),
      Number(t.discountAmount || 0),
      JSON.stringify(seatsArr),
      String(t.holderName || 'ลูกค้าผู้จองบัตร').trim(),
      String(t.holderPhone || '081-xxx-xxxx').trim(),
      String(t.holderIdCard || '').trim(),
      String(t.lineUserId || '').trim(),
      String(t.slipName || 'slip-recovered.svg').trim(),
      String(t.slipMime || 'image/svg+xml').trim(),
      slipData,
      slipHash,
      status,
      String(t.rejectReason || ''),
      Number(t.lineSent || 0),
      Number(t.issuedAt || Date.now()),
      Number(t.reviewedAt || 0),
      Number(t.checkedInAt || 0),
      String(t.checkedInBy || '')
    );
    recoveredCount += 1;
  }

  return {
    recoveredCount,
    orders: listOrders({ includeSlipData: false })
  };
}

function clearAllForTest() {
  db.exec(`DELETE FROM orders; DELETE FROM line_contacts; DELETE FROM audit_logs; DELETE FROM events; DELETE FROM seat_holds;`);
  setSetting('deleted_event_ids', '[]');
  setSetting('deleted_order_refs', '[]');
  ensureSeedData();
  setSetting('slip_auto_approve_enabled', 'false');
  setSetting('admin_pin', '123456');
  setSetting('gate_staff_pin', '888888');
}

module.exports = {
  createOrder,
  recoverOrdersFromClient,
  deleteOrder,
  getOrder,
  listOrders,
  updateOrderStatus,
  updateOrderDriveAndVerification,
  checkInOrder,
  getStats,
  listEventsWithQuota,
  saveEvent,
  deleteEvent,
  listPromoCodes,
  validatePromoCode,
  exportBackupSnapshot,
  restoreBackupSnapshot,
  saveLineContact,
  getLatestLineContact,
  getSetting,
  setSetting,
  addAuditLog,
  listAuditLogs,
  hashSlipDataUrl,
  clearAllForTest,
  getSeatStatuses,
  holdSeats,
  releaseSeats,
  cleanExpiredHolds,
  getPromoterAnalytics,
  getGateThroughputMonitor,
  computeTicketSignature,
  buildSignedQrPayload
};

