/**
 * Supabase PostgreSQL Cloud Integration for STAGE PASS.
 * Supports persistent storage across Vercel serverless cold starts.
 * When DATABASE_URL is present, syncs orders, settings, events, and audit logs.
 */

let pool = null;
let isConnected = false;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!connectionString || connectionString.includes('[YOUR-PASSWORD]')) {
    return null;
  }

  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10
    });

    pool.on('error', (err) => {
      console.error('[Postgres Pool Error]', err.message);
    });

    return pool;
  } catch (err) {
    console.error('[Postgres Init Failed]', err.message);
    return null;
  }
}

async function initPostgresTables() {
  const p = getPool();
  if (!p) return false;

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS orders (
        ref VARCHAR(64) PRIMARY KEY,
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
        holder_id_card TEXT DEFAULT '',
        line_user_id TEXT DEFAULT '',
        slip_name TEXT NOT NULL,
        slip_mime TEXT NOT NULL,
        slip_data TEXT NOT NULL,
        slip_hash TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        reject_reason TEXT DEFAULT '',
        line_sent INTEGER NOT NULL DEFAULT 0,
        line_log TEXT DEFAULT '',
        issued_at BIGINT NOT NULL,
        reviewed_at BIGINT DEFAULT 0,
        checked_in_at BIGINT DEFAULT 0,
        checked_in_by TEXT DEFAULT '',
        seats TEXT DEFAULT '[]',
        drive_file_id TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_pg_orders_slip_hash ON orders(slip_hash);
      CREATE INDEX IF NOT EXISTS idx_pg_orders_status ON orders(status);

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(128) PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS line_contacts (
        user_id VARCHAR(128) PRIMARY KEY,
        display_name TEXT NOT NULL,
        last_message TEXT DEFAULT '',
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        target_ref TEXT DEFAULT '',
        detail TEXT NOT NULL,
        actor TEXT DEFAULT 'Admin',
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'world',
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        price_range TEXT NOT NULL,
        badge TEXT NOT NULL DEFAULT 'เปิดจำหน่าย',
        is_accent INTEGER NOT NULL DEFAULT 1,
        gradient TEXT NOT NULL DEFAULT 'linear-gradient(135deg, #4d1313, #1f1f1f)',
        image TEXT DEFAULT '',
        quota_vip INTEGER NOT NULL DEFAULT 50,
        quota_a INTEGER NOT NULL DEFAULT 100,
        quota_b INTEGER NOT NULL DEFAULT 120,
        quota_c INTEGER NOT NULL DEFAULT 150
      );

      CREATE TABLE IF NOT EXISTS promo_codes (
        code VARCHAR(64) PRIMARY KEY,
        discount_type TEXT NOT NULL DEFAULT 'percent',
        discount_value INTEGER NOT NULL DEFAULT 10,
        min_spend INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS seat_holds (
        seat_id VARCHAR(64) PRIMARY KEY,
        holder_session TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);
    isConnected = true;
    console.log('[Supabase PostgreSQL] Connected and tables verified successfully.');
    return true;
  } catch (err) {
    console.error('[Supabase PostgreSQL Init Error]', err.message);
    return false;
  }
}

// Background sync helpers
function queryAsync(text, params = []) {
  const p = getPool();
  if (!p) return Promise.resolve(null);
  return p.query(text, params).catch((err) => {
    console.error('[Postgres Query Error]', err.message);
    return null;
  });
}

function syncSetting(key, value) {
  return queryAsync(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(key), String(value)]
  );
}

function syncOrder(o) {
  if (!o || !o.ref) return Promise.resolve(null);
  return queryAsync(
    `INSERT INTO orders (
      ref, title, date, venue, zone, qty, unit_price, total, promo_code, discount_amount,
      holder_name, holder_phone, holder_id_card, line_user_id, slip_name, slip_mime, slip_data,
      slip_hash, status, reject_reason, line_sent, line_log, issued_at, reviewed_at, checked_in_at,
      checked_in_by, seats, drive_file_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22, $23, $24, $25,
      $26, $27, $28
    ) ON CONFLICT (ref) DO UPDATE SET
      status = EXCLUDED.status,
      reject_reason = EXCLUDED.reject_reason,
      line_sent = EXCLUDED.line_sent,
      line_log = EXCLUDED.line_log,
      reviewed_at = EXCLUDED.reviewed_at,
      checked_in_at = EXCLUDED.checked_in_at,
      checked_in_by = EXCLUDED.checked_in_by,
      drive_file_id = EXCLUDED.drive_file_id`,
    [
      String(o.ref),
      String(o.title || ''),
      String(o.date || ''),
      String(o.venue || ''),
      String(o.zone || ''),
      Number(o.qty) || 1,
      Number(o.unitPrice) || 0,
      Number(o.total) || 0,
      String(o.promoCode || ''),
      Number(o.discountAmount) || 0,
      String(o.holderName || ''),
      String(o.holderPhone || ''),
      String(o.holderIdCard || ''),
      String(o.lineUserId || ''),
      String(o.slipName || ''),
      String(o.slipMime || 'image/png'),
      String(o.slipData || ''),
      String(o.slipHash || ''),
      String(o.status || 'pending'),
      String(o.rejectReason || ''),
      Number(o.lineSent ? 1 : 0),
      String(o.lineLog || ''),
      Number(o.issuedAt) || Date.now(),
      Number(o.reviewedAt) || 0,
      Number(o.checkedInAt) || 0,
      String(o.checkedInBy || ''),
      typeof o.seats === 'string' ? o.seats : JSON.stringify(o.seats || []),
      String(o.driveFileId || '')
    ]
  );
}

function syncOrderStatus(ref, status, rejectReason = '', lineSent = 0, lineLog = '', reviewedAt = 0) {
  return queryAsync(
    `UPDATE orders SET
       status = $2,
       reject_reason = $3,
       line_sent = $4,
       line_log = $5,
       reviewed_at = $6
     WHERE ref = $1`,
    [String(ref), String(status), String(rejectReason), Number(lineSent ? 1 : 0), String(lineLog), Number(reviewedAt) || Date.now()]
  );
}

function syncOrderCheckIn(ref, checkedInAt, checkedInBy) {
  return queryAsync(
    `UPDATE orders SET checked_in_at = $2, checked_in_by = $3 WHERE ref = $1`,
    [String(ref), Number(checkedInAt) || Date.now(), String(checkedInBy || '')]
  );
}

function syncOrderDrive(ref, driveFileId) {
  return queryAsync(
    `UPDATE orders SET drive_file_id = $2 WHERE ref = $1`,
    [String(ref), String(driveFileId || '')]
  );
}

function syncAuditLog(log) {
  if (!log) return Promise.resolve(null);
  return queryAsync(
    `INSERT INTO audit_logs (action, target_ref, detail, actor, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [String(log.action), String(log.targetRef || ''), String(log.detail || ''), String(log.actor || 'Admin'), Number(log.createdAt) || Date.now()]
  );
}

function syncEvent(e) {
  if (!e) return Promise.resolve(null);
  return queryAsync(
    `INSERT INTO events (
      id, title, category, date, venue, price_range, badge, is_accent, gradient, image, quota_vip, quota_a, quota_b, quota_c
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    ) ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      date = EXCLUDED.date,
      venue = EXCLUDED.venue,
      price_range = EXCLUDED.price_range,
      badge = EXCLUDED.badge,
      is_accent = EXCLUDED.is_accent,
      gradient = EXCLUDED.gradient,
      image = EXCLUDED.image,
      quota_vip = EXCLUDED.quota_vip,
      quota_a = EXCLUDED.quota_a,
      quota_b = EXCLUDED.quota_b,
      quota_c = EXCLUDED.quota_c`,
    [
      Number(e.id),
      String(e.title || ''),
      String(e.category || 'world'),
      String(e.date || ''),
      String(e.venue || ''),
      String(e.priceRange || ''),
      String(e.badge || 'เปิดจำหน่าย'),
      Number(e.isAccent ? 1 : 0),
      String(e.gradient || ''),
      String(e.image || ''),
      Number(e.quotaVip) || 0,
      Number(e.quotaA) || 0,
      Number(e.quotaB) || 0,
      Number(e.quotaC) || 0
    ]
  );
}

function deleteEvent(id) {
  return queryAsync(`DELETE FROM events WHERE id = $1`, [Number(id)]);
}

async function hydrateSqliteFromPostgres(sqliteDb) {
  const p = getPool();
  if (!p) return false;

  try {
    // 1. Settings
    const settingsRes = await p.query('SELECT key, value FROM settings');
    if (settingsRes && settingsRes.rows && settingsRes.rows.length) {
      const stmt = sqliteDb.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
      for (const row of settingsRes.rows) {
        try { stmt.run(row.key, row.value); } catch (_) {}
      }
    }

    // 2. Orders
    const ordersRes = await p.query('SELECT * FROM orders ORDER BY issued_at ASC');
    if (ordersRes && ordersRes.rows && ordersRes.rows.length) {
      const orderStmt = sqliteDb.prepare(`
        INSERT INTO orders (
          ref, title, date, venue, zone, qty, unit_price, total, promo_code, discount_amount,
          holder_name, holder_phone, holder_id_card, line_user_id, slip_name, slip_mime, slip_data,
          slip_hash, status, reject_reason, line_sent, line_log, issued_at, reviewed_at, checked_in_at,
          checked_in_by, seats, drive_file_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ref) DO UPDATE SET
          status = excluded.status,
          reviewed_at = excluded.reviewed_at,
          checked_in_at = excluded.checked_in_at,
          checked_in_by = excluded.checked_in_by,
          drive_file_id = excluded.drive_file_id
      `);
      for (const o of ordersRes.rows) {
        try {
          orderStmt.run(
            o.ref, o.title, o.date, o.venue, o.zone, o.qty, o.unit_price, o.total, o.promo_code, o.discount_amount,
            o.holder_name, o.holder_phone, o.holder_id_card, o.line_user_id, o.slip_name, o.slip_mime, o.slip_data,
            o.slip_hash, o.status, o.reject_reason, o.line_sent, o.line_log, o.issued_at, o.reviewed_at, o.checked_in_at,
            o.checked_in_by, o.seats, o.drive_file_id
          );
        } catch (_) {}
      }
    }

    console.log(`[Supabase PostgreSQL] Hydrated ${settingsRes.rows.length} settings and ${ordersRes.rows.length} orders into local cache.`);
    return true;
  } catch (err) {
    console.error('[Supabase PostgreSQL Hydrate Error]', err.message);
    return false;
  }
}

function getDatabaseHost() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!url) return 'Local SQLite (Demo)';
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return 'Supabase PostgreSQL';
  }
}

module.exports = {
  getPool,
  initPostgresTables,
  queryAsync,
  syncSetting,
  syncOrder,
  syncOrderStatus,
  syncOrderCheckIn,
  syncOrderDrive,
  syncAuditLog,
  syncEvent,
  deleteEvent,
  hydrateSqliteFromPostgres,
  getDatabaseHost,
  isConnected: () => isConnected
};
