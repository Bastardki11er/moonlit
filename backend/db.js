/* ============================================================
   Moonlit — user database (SQLite via sql.js, pure WebAssembly)
   ------------------------------------------------------------
   Why sql.js instead of better-sqlite3? better-sqlite3 needs a
   compiled native binary, which broke on the server (old glibc,
   no GitHub access for prebuilt downloads). sql.js is SQLite
   compiled to WebAssembly: `npm install` just copies files, so
   it works on ANY machine with zero compilation. Same .db file
   format — your existing moonlit.db keeps working.

   One file, zero setup: the database lives in
   backend/moonlit.db on your server. It survives restarts.
   Back it up by copying that one file.

   TABLES
   - users:        one row per visitor (anonymous id, no password)
   - readings:     every AI reading, linked to its user
   - daily_usage:  free-reading quota per user per day
   - orders:       XorPay payment orders, linked to users
   - accounts:     email + password accounts (optional login)
   - sessions:     login tokens for accounts (30-day expiry)
   ============================================================ */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "moonlit.db");
const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
`;

let db = null;

function persist() {
  // sql.js is in-memory: write the whole DB file after every change.
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

/* Small query helpers (same shape as the old better-sqlite3 code). */
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persist();
}
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

/* ---------- init (async: WebAssembly has to load first) ---------- */

async function init() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    // Safety backup the first time we open an existing database.
    const bak = DB_PATH + ".bak";
    if (!fs.existsSync(bak)) fs.copyFileSync(DB_PATH, bak);
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.exec(SCHEMA);
  // Migration for databases created before email accounts existed.
  try { db.exec("ALTER TABLE users ADD COLUMN account_id INTEGER"); } catch (e) { /* already there */ }
  persist();
  return api;
}

/* ---------- users ---------- */

// Get the user, or create a new one when the id is unknown/missing.
function getOrCreateUser(id) {
  if (id) {
    const row = get("SELECT * FROM users WHERE id = ?", [id]);
    if (row) {
      run("UPDATE users SET last_seen_at = ? WHERE id = ?", [now(), id]);
      return row;
    }
  }
  const newId = crypto.randomUUID();
  const t = now();
  run("INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)", [newId, t, t]);
  return get("SELECT * FROM users WHERE id = ?", [newId]);
}

function setNickname(id, nickname) {
  run("UPDATE users SET nickname = ? WHERE id = ?", [String(nickname).slice(0, 40), id]);
}

/* ---------- free quota (per user, per day) ---------- */

function freeLeftToday(userId, freePerDay) {
  const row = get("SELECT count FROM daily_usage WHERE user_id = ? AND day = ?", [userId, today()]);
  return freePerDay - (row ? row.count : 0);
}

function countReadingToday(userId) {
  run(
    `INSERT INTO daily_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`,
    [userId, today()]
  );
  run("UPDATE users SET readings_total = readings_total + 1 WHERE id = ?", [userId]);
}

function addPaidReadings(userId, n) {
  run("UPDATE users SET paid_readings = paid_readings + ? WHERE id = ?", [n, userId]);
}

function usePaidReading(userId) {
  const row = get("SELECT paid_readings FROM users WHERE id = ?", [userId]);
  if (row && row.paid_readings > 0) {
    run("UPDATE users SET paid_readings = paid_readings - 1 WHERE id = ?", [userId]);
    return true;
  }
  return false;
}

/* ---------- readings history ---------- */

function saveReading(userId, { question, spread, cards, readingText }) {
  run(
    `INSERT INTO readings (user_id, question, spread, cards_json, reading_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, question, spread || "", JSON.stringify(cards), readingText, now()]
  );
  return get("SELECT seq AS id FROM sqlite_sequence WHERE name = 'readings'").id;
}

function getReadings(userId, limit = 20) {
  return all(
    `SELECT id, question, spread, cards_json, created_at
     FROM readings WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  ).map((r) => ({ ...r, cards: JSON.parse(r.cards_json), cards_json: undefined }));
}

function getReadingDetail(userId, readingId) {
  const r = get("SELECT * FROM readings WHERE id = ? AND user_id = ?", [readingId, userId]);
  if (!r) return null;
  return { ...r, cards: JSON.parse(r.cards_json), cards_json: undefined };
}

/* ---------- orders ---------- */

function createOrder(orderId, userId, amount, readings) {
  run(
    `INSERT INTO orders (order_id, user_id, amount, readings, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [orderId, userId || null, amount, readings, now()]
  );
}

function orderPaid(orderId) {
  const o = get("SELECT status FROM orders WHERE order_id = ?", [orderId]);
  return !!o && o.status === "paid";
}

function markOrderPaid(orderId) {
  const o = get("SELECT * FROM orders WHERE order_id = ?", [orderId]);
  if (!o || o.status === "paid") return null;
  run("UPDATE orders SET status = 'paid', paid_at = ? WHERE order_id = ?", [now(), orderId]);
  return o; // caller credits o.user_id with o.readings
}

/* ---------- admin stats ---------- */

function getStats() {
  return {
    usersTotal: get("SELECT COUNT(*) AS c FROM users").c,
    usersToday: get("SELECT COUNT(*) AS c FROM users WHERE date(created_at) = date('now')").c,
    readingsTotal: get("SELECT COUNT(*) AS c FROM readings").c,
    readingsToday: get("SELECT COUNT(*) AS c FROM readings WHERE date(created_at) = date('now')").c,
    ordersPending: get("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'").c,
    ordersPaid: get("SELECT COUNT(*) AS c FROM orders WHERE status = 'paid'").c,
    revenueCny: get("SELECT COALESCE(SUM(amount), 0) AS s FROM orders WHERE status = 'paid'").s,
  };
}

function recentReadings(limit = 20) {
  return all(
    `SELECT id, user_id, substr(question, 1, 60) AS question, spread, created_at
     FROM readings ORDER BY id DESC LIMIT ?`,
    [limit]
  );
}

function recentUsers(limit = 20) {
  return all(
    `SELECT id, substr(id, 1, 8) AS short_id, created_at, last_seen_at,
            readings_total, paid_readings
     FROM users ORDER BY last_seen_at DESC LIMIT ?`,
    [limit]
  );
}

/* ---------- email accounts & sessions ---------- */

// scrypt password hashing (Node built-in crypto, no new dependency).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  try {
    const check = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(check, Buffer.from(hash, "hex"));
  } catch (e) {
    return false;
  }
}

function createAccount(email, password) {
  email = String(email).trim().toLowerCase();
  if (get("SELECT id FROM accounts WHERE email = ?", [email])) {
    return { error: "exists" };
  }
  run("INSERT INTO accounts (email, password_hash, created_at) VALUES (?, ?, ?)",
    [email, hashPassword(password), now()]);
  return get("SELECT id, email, created_at FROM accounts WHERE email = ?", [email]);
}

function getAccountByEmail(email) {
  return get("SELECT * FROM accounts WHERE email = ?", [String(email).trim().toLowerCase()]);
}

function createSession(accountId, daysValid = 30) {
  const token = crypto.randomBytes(32).toString("hex");
  const exp = new Date(Date.now() + daysValid * 864e5).toISOString();
  run("INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, accountId, now(), exp]);
  return token;
}

// Returns { accountId, email } or null (also cleans up expired tokens).
function getSessionAccount(token) {
  if (!token) return null;
  const s = get(
    `SELECT s.token, s.account_id, s.expires_at, a.email
     FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ?`,
    [token]
  );
  if (!s) return null;
  if (s.expires_at < now()) {
    run("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  return { accountId: s.account_id, email: s.email };
}

function deleteSession(token) {
  run("DELETE FROM sessions WHERE token = ?", [token]);
}

// The users-row that belongs to an account (one per account).
function getUserForAccount(accountId) {
  return get("SELECT * FROM users WHERE account_id = ?", [accountId]);
}
function attachUserToAccount(userId, accountId) {
  run("UPDATE users SET account_id = ? WHERE id = ?", [accountId, userId]);
}

// Move everything from an anonymous user row into the account's user row.
function mergeUsers(fromUserId, toUserId) {
  if (!fromUserId || fromUserId === toUserId) return;
  run("UPDATE readings SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  run("UPDATE orders SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  const rows = all("SELECT day, count FROM daily_usage WHERE user_id = ?", [fromUserId]);
  for (const r of rows) {
    run(
      `INSERT INTO daily_usage (user_id, day, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET count = count + ?`,
      [toUserId, r.day, r.count, r.count]
    );
  }
  run("DELETE FROM daily_usage WHERE user_id = ?", [fromUserId]);
  const from = get("SELECT readings_total, paid_readings FROM users WHERE id = ?", [fromUserId]);
  if (from) {
    run(
      "UPDATE users SET readings_total = readings_total + ?, paid_readings = paid_readings + ? WHERE id = ?",
      [from.readings_total || 0, from.paid_readings || 0, toUserId]
    );
    run("DELETE FROM users WHERE id = ?", [fromUserId]);
  }
}

const api = {
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
  // email accounts
  hashPassword,
  verifyPassword,
  createAccount,
  getAccountByEmail,
  createSession,
  getSessionAccount,
  deleteSession,
  getUserForAccount,
  attachUserToAccount,
  mergeUsers,
};

module.exports = { init };
