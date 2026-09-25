/* ============================================================
   Moonlit — user database (SQLite via better-sqlite3)
   ------------------------------------------------------------
   One file, zero setup: the database lives in backend/moonlit.db
   on your server. It survives restarts. Back it up by copying
   that one file.

   TABLES
   - users:        one row per visitor (anonymous id, no password)
   - readings:     every AI reading, linked to its user
   - daily_usage:  free-reading quota per user per day
   - orders:       XorPay payment orders, linked to users
   ============================================================ */

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const db = new Database(path.join(__dirname, "moonlit.db"));
db.pragma("journal_mode = WAL"); // safer + faster for concurrent reads

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  nickname      TEXT,
  readings_total INTEGER NOT NULL DEFAULT 0,
  paid_readings  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  question     TEXT NOT NULL,
  spread       TEXT,
  cards_json   TEXT NOT NULL,
  reading_text TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_user ON readings(user_id, id DESC);
CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS orders (
  order_id   TEXT PRIMARY KEY,
  user_id    TEXT,
  amount     REAL,
  readings   INTEGER,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  paid_at    TEXT
);
`);

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

/* ---------- users ---------- */

// Get the user, or create a new one when the id is unknown/missing.
function getOrCreateUser(id) {
  if (id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (row) {
      db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now(), id);
      return row;
    }
  }
  const newId = crypto.randomUUID();
  const t = now();
  db.prepare(
    "INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)"
  ).run(newId, t, t);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(newId);
}

function setNickname(id, nickname) {
  db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(
    String(nickname).slice(0, 40), id
  );
}

/* ---------- free quota (per user, per day) ---------- */

function freeLeftToday(userId, freePerDay) {
  const row = db
    .prepare("SELECT count FROM daily_usage WHERE user_id = ? AND day = ?")
    .get(userId, today());
  return freePerDay - (row ? row.count : 0);
}

function countReadingToday(userId) {
  db.prepare(
    `INSERT INTO daily_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`
  ).run(userId, today());
  db.prepare(
    "UPDATE users SET readings_total = readings_total + 1 WHERE id = ?"
  ).run(userId);
}

function addPaidReadings(userId, n) {
  db.prepare("UPDATE users SET paid_readings = paid_readings + ? WHERE id = ?").run(n, userId);
}

function usePaidReading(userId) {
  const row = db.prepare("SELECT paid_readings FROM users WHERE id = ?").get(userId);
  if (row && row.paid_readings > 0) {
    db.prepare("UPDATE users SET paid_readings = paid_readings - 1 WHERE id = ?").run(userId);
    return true;
  }
  return false;
}

/* ---------- readings history ---------- */

function saveReading(userId, { question, spread, cards, readingText }) {
  const info = db
    .prepare(
      `INSERT INTO readings (user_id, question, spread, cards_json, reading_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, question, spread || "", JSON.stringify(cards), readingText, now());
  return info.lastInsertRowid;
}

function getReadings(userId, limit = 20) {
  return db
    .prepare(
      `SELECT id, question, spread, cards_json, created_at
       FROM readings WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit)
    .map((r) => ({ ...r, cards: JSON.parse(r.cards_json), cards_json: undefined }));
}

function getReadingDetail(userId, readingId) {
  const r = db
    .prepare("SELECT * FROM readings WHERE id = ? AND user_id = ?")
    .get(readingId, userId);
  if (!r) return null;
  return { ...r, cards: JSON.parse(r.cards_json), cards_json: undefined };
}

/* ---------- orders ---------- */

function createOrder(orderId, userId, amount, readings) {
  db.prepare(
    `INSERT INTO orders (order_id, user_id, amount, readings, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(orderId, userId || null, amount, readings, now());
}

function orderPaid(orderId) {
  const o = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(orderId);
  return !!o && o.status === "paid";
}

function markOrderPaid(orderId) {
  const o = db.prepare("SELECT * FROM orders WHERE order_id = ?").get(orderId);
  if (!o || o.status === "paid") return null;
  db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE order_id = ?").run(now(), orderId);
  return o; // caller credits o.user_id with o.readings
}

/* ---------- admin stats ---------- */

function getStats() {
  const q = (sql, ...p) => db.prepare(sql).get(...p);
  return {
    usersTotal: q("SELECT COUNT(*) AS c FROM users").c,
    usersToday: q("SELECT COUNT(*) AS c FROM users WHERE date(created_at) = date('now')").c,
    readingsTotal: q("SELECT COUNT(*) AS c FROM readings").c,
    readingsToday: q("SELECT COUNT(*) AS c FROM readings WHERE date(created_at) = date('now')").c,
    ordersPending: q("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'").c,
    ordersPaid: q("SELECT COUNT(*) AS c FROM orders WHERE status = 'paid'").c,
    revenueCny: q("SELECT COALESCE(SUM(amount), 0) AS s FROM orders WHERE status = 'paid'").s,
  };
}

function recentReadings(limit = 20) {
  return db
    .prepare(
      `SELECT id, user_id, substr(question, 1, 60) AS question, spread, created_at
       FROM readings ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
}

function recentUsers(limit = 20) {
  return db
    .prepare(
      `SELECT id, substr(id, 1, 8) AS short_id, created_at, last_seen_at,
              readings_total, paid_readings
       FROM users ORDER BY last_seen_at DESC LIMIT ?`
    )
    .all(limit);
}

module.exports = {
  getOrCreateUser,
  setNickname,
  freeLeftToday,
  countReadingToday,
  addPaidReadings,
  usePaidReading,
  saveReading,
  getReadings,
  getReadingDetail,
  createOrder,
  orderPaid,
  markOrderPaid,
  getStats,
  recentReadings,
  recentUsers,
};
