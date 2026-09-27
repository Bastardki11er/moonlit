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
  paid_readings  INTEGER NOT NULL DEFAULT 0,
  bonus_readings INTEGER NOT NULL DEFAULT 0,
  referred_by  TEXT
);
CREATE TABLE IF NOT EXISTS share_grants (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS checkins (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,   -- Beijing date (user-facing daily ritual)
  PRIMARY KEY (user_id, day)
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
CREATE TABLE IF NOT EXISTS followups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id INTEGER NOT NULL REFERENCES readings(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followups_reading ON followups(reading_id, id);
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
CREATE TABLE IF NOT EXISTS email_codes (
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'register', -- register | reset
  code       TEXT NOT NULL,                     -- 6 位数字
  attempts   INTEGER NOT NULL DEFAULT 0,        -- 验错次数，超限作废
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, purpose)
);
CREATE TABLE IF NOT EXISTS divinations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL,              -- bazi | ziwei | astro
  input_json   TEXT NOT NULL,              -- validated birth data (no secrets)
  chart_json   TEXT NOT NULL,              -- chart data for display
  reading_text TEXT NOT NULL,
  question     TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_divinations_user ON divinations(user_id, kind, id DESC);
CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL DEFAULT 'note', -- note | tarot | bazi | ziwei | astro
  ref_id     INTEGER,                       -- reading/divination id when linked
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL,
  mood       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal(user_id, id DESC);
CREATE TABLE IF NOT EXISTS birth_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gender       TEXT NOT NULL,
  birth_year   INTEGER NOT NULL,
  birth_month  INTEGER NOT NULL,
  birth_day    INTEGER NOT NULL,
  birth_hour   INTEGER NOT NULL,
  birth_minute INTEGER,
  calendar_type TEXT NOT NULL DEFAULT 'solar',
  is_leap_month INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
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
  // Migration for the share-to-earn bonus readings (2026-09-26).
  try { db.exec("ALTER TABLE users ADD COLUMN bonus_readings INTEGER NOT NULL DEFAULT 0"); } catch (e) { /* already there */ }
  // Migration for referral attribution (2026-09-26).
  try { db.exec("ALTER TABLE users ADD COLUMN referred_by TEXT"); } catch (e) { /* already there */ }
  // Migration for member birth profiles (2026-09-26). CREATE TABLE IF NOT
  // EXISTS is idempotent — safe to run on every startup.
  db.exec(`CREATE TABLE IF NOT EXISTS birth_profiles (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    gender       TEXT NOT NULL,
    birth_year   INTEGER NOT NULL,
    birth_month  INTEGER NOT NULL,
    birth_day    INTEGER NOT NULL,
    birth_hour   INTEGER NOT NULL,
    birth_minute INTEGER,
    calendar_type TEXT NOT NULL DEFAULT 'solar',
    is_leap_month INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL
  )`);
  // 2026-09-26: 经纬度/出生地字段下线 — 从老表里删掉这些列（失败也不影响启动）。
  for (const col of ["latitude", "longitude", "birth_place"]) {
    try { db.exec(`ALTER TABLE birth_profiles DROP COLUMN ${col}`); } catch (e) { /* already gone */ }
  }
  persist();
  return api;
}

/* ---------- users ---------- */

// Get the user, or create a new one when the id is unknown/missing.
// Security: only accept ids shaped like the UUIDs we issue. A forged or
// garbage id is treated as "no id" (fresh user) instead of creating junk rows.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function getOrCreateUser(id) {
  if (id && UUID_RE.test(id)) {
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

/* ---------- member perks （注册用户权益） ----------
   isRegistered: 该 user 行是否绑定了邮箱账号（users.account_id 非空）。
   力度说明：游客已经全免费，注册是"更爽"而不是"卡游客脖子"——
   额度加成温和（AI 调用有真实成本），便利功能给足。 */
function isRegistered(userId) {
  const row = get("SELECT account_id FROM users WHERE id = ?", [userId]);
  return !!(row && row.account_id != null);
}

/* ---------- free quota (per user, per day) ---------- */

function freeLeftToday(userId, freePerDay) {
  const row = get("SELECT count FROM daily_usage WHERE user_id = ? AND day = ?", [userId, today()]);
  return freePerDay - (row ? row.count : 0);
}

function countReadingToday(userId, n = 1) {
  n = Math.max(1, Math.min(10, n | 0));
  run(
    `INSERT INTO daily_usage (user_id, day, count) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + ?`,
    [userId, today(), n, n]
  );
  run("UPDATE users SET readings_total = readings_total + ? WHERE id = ?", [n, userId]);
}

function addPaidReadings(userId, n) {
  run("UPDATE users SET paid_readings = paid_readings + ? WHERE id = ?", [n, userId]);
}

function usePaidReading(userId) {
  return usePaidReadings(userId, 1);
}

/* Consume n paid readings at once (Celtic Cross costs 2). */
function usePaidReadings(userId, n = 1) {
  n = Math.max(1, Math.min(10, n | 0));
  const row = get("SELECT paid_readings FROM users WHERE id = ?", [userId]);
  if (row && row.paid_readings >= n) {
    run("UPDATE users SET paid_readings = paid_readings - ? WHERE id = ?", [n, userId]);
    return true;
  }
  return false;
}

/* ---------- share-to-earn bonus readings ---------- */

const SHARE_BONUS_PER_DAY = 2; // 游客每天最多靠分享赚 2 次
const SHARE_BONUS_MEMBER_PER_DAY = 3; // 注册用户每天 3 次

function getBonusReadings(userId) {
  const row = get("SELECT bonus_readings FROM users WHERE id = ?", [userId]);
  return row ? (row.bonus_readings | 0) : 0;
}

function useBonusReadings(userId, n = 1) {
  n = Math.max(1, Math.min(10, n | 0));
  const row = get("SELECT bonus_readings FROM users WHERE id = ?", [userId]);
  if (row && row.bonus_readings >= n) {
    run("UPDATE users SET bonus_readings = bonus_readings - ? WHERE id = ?", [n, userId]);
    return true;
  }
  return false;
}

/* Grant +1 bonus reading for sharing. Capped per day (member cap is higher). */
function grantShareBonus(userId) {
  const cap = isRegistered(userId) ? SHARE_BONUS_MEMBER_PER_DAY : SHARE_BONUS_PER_DAY;
  const day = today();
  const row = get("SELECT count FROM share_grants WHERE user_id = ? AND day = ?", [userId, day]);
  const used = row ? row.count : 0;
  if (used >= cap) {
    return { ok: false, reason: "daily_cap", bonus: getBonusReadings(userId), grantsLeft: 0 };
  }
  run(
    `INSERT INTO share_grants (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`,
    [userId, day]
  );
  run("UPDATE users SET bonus_readings = bonus_readings + 1 WHERE id = ?", [userId]);
  persist();
  return { ok: true, bonus: getBonusReadings(userId), grantsLeft: cap - used - 1 };
}

function shareGrantsLeftToday(userId) {
  const cap = isRegistered(userId) ? SHARE_BONUS_MEMBER_PER_DAY : SHARE_BONUS_PER_DAY;
  const row = get("SELECT count FROM share_grants WHERE user_id = ? AND day = ?", [userId, today()]);
  return Math.max(0, cap - (row ? row.count : 0));
}

/* ---------- referral: ?ref=<userId> invite links ----------
   The referred newcomer and the referrer each get bonus readings.
   注册用户做推荐人时双方各 +2（游客推荐人 +1）——鼓励先注册再邀请。
   One referral per newcomer ever; referrer capped at 10 rewards/day. */
const REFERRAL_PER_DAY_CAP = 10;
const REFERRAL_REWARD_GUEST = 1;
const REFERRAL_REWARD_MEMBER = 2;
function applyReferral(newUserId, refId) {
  if (!refId || !UUID_RE.test(refId) || refId === newUserId) return { applied: false };
  const refUser = get("SELECT id FROM users WHERE id = ?", [refId]);
  if (!refUser) return { applied: false };
  const me = get("SELECT referred_by FROM users WHERE id = ?", [newUserId]);
  if (!me || me.referred_by) return { applied: false }; // already referred once
  const given = get(
    "SELECT COUNT(*) AS c FROM users WHERE referred_by = ? AND created_at >= ?",
    [refId, today()]
  );
  if (given && given.c >= REFERRAL_PER_DAY_CAP) return { applied: false, reason: "referrer_cap" };
  const reward = isRegistered(refId) ? REFERRAL_REWARD_MEMBER : REFERRAL_REWARD_GUEST;
  run("UPDATE users SET referred_by = ? WHERE id = ?", [refId, newUserId]);
  run("UPDATE users SET bonus_readings = bonus_readings + ? WHERE id IN (?, ?)", [reward, newUserId, refId]);
  persist();
  return { applied: true, bonus: getBonusReadings(newUserId), rewardAmount: reward };
}

/* ---------- daily check-in （每日签到） ----------
   Beijing-date based (matches the almanac widget). Streak = consecutive
   days ending today (or yesterday if today not checked in yet).
   Every 7th consecutive day grants bonus readings: 游客 +1，注册用户 +2. */
const CHECKIN_REWARD_EVERY = 7;
const CHECKIN_REWARD_GUEST = 1;
const CHECKIN_REWARD_MEMBER = 2;
function beijingDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(d);
}
function shiftDay(dayStr, delta) {
  const d = new Date(dayStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function checkinStreak(userId) {
  const todayBj = beijingDay();
  let cursor = get("SELECT 1 AS x FROM checkins WHERE user_id = ? AND day = ?", [userId, todayBj])
    ? todayBj : shiftDay(todayBj, -1);
  let streak = 0;
  while (streak < 370) {
    const row = get("SELECT 1 AS x FROM checkins WHERE user_id = ? AND day = ?", [userId, cursor]);
    if (!row) break;
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  return { streak, checkedInToday: !!get(
    "SELECT 1 AS x FROM checkins WHERE user_id = ? AND day = ?", [userId, todayBj]) };
}
function doCheckin(userId) {
  const day = beijingDay();
  const already = get("SELECT 1 AS x FROM checkins WHERE user_id = ? AND day = ?", [userId, day]);
  if (already) {
    const s = checkinStreak(userId);
    return { ok: true, duplicate: true, ...s, rewardGranted: false, rewardAmount: 0 };
  }
  run("INSERT INTO checkins (user_id, day) VALUES (?, ?)", [userId, day]);
  const s = checkinStreak(userId);
  let rewardGranted = false, rewardAmount = 0;
  if (s.streak > 0 && s.streak % CHECKIN_REWARD_EVERY === 0) {
    rewardAmount = isRegistered(userId) ? CHECKIN_REWARD_MEMBER : CHECKIN_REWARD_GUEST;
    run("UPDATE users SET bonus_readings = bonus_readings + ? WHERE id = ?", [rewardAmount, userId]);
    rewardGranted = true;
  }
  persist();
  return { ok: true, duplicate: false, ...s, rewardGranted, rewardAmount, bonus: getBonusReadings(userId) };
}

/* ---------- readings history ---------- */

/* 注册用户每天首次追问免费：统计今天已追问次数 */
function followupsToday(userId) {
  const row = get(
    "SELECT COUNT(*) AS c FROM followups WHERE user_id = ? AND substr(created_at, 1, 10) = ?",
    [userId, today()]
  );
  return row ? row.c : 0;
}

/* ---------- 出生信息记忆（注册用户专享） ----------
   保存命理排盘的出生信息，下次一键填入。只存排盘需要的字段。 */
function getBirthProfile(userId) {
  return get("SELECT * FROM birth_profiles WHERE user_id = ?", [userId]) || null;
}

function saveBirthProfile(userId, p) {
  run(
    `INSERT INTO birth_profiles
       (user_id, gender, birth_year, birth_month, birth_day, birth_hour, birth_minute,
        calendar_type, is_leap_month, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       gender = excluded.gender, birth_year = excluded.birth_year,
       birth_month = excluded.birth_month, birth_day = excluded.birth_day,
       birth_hour = excluded.birth_hour, birth_minute = excluded.birth_minute,
       calendar_type = excluded.calendar_type, is_leap_month = excluded.is_leap_month,
       updated_at = excluded.updated_at`,
    [userId, p.gender, p.birthYear, p.birthMonth, p.birthDay, p.birthHour,
     p.birthMinute == null ? null : p.birthMinute, p.calendarType,
     p.isLeapMonth ? 1 : 0, now()]
  );
  persist();
}

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
  return { ...r, cards: JSON.parse(r.cards_json), cards_json: undefined,
           followups: getFollowups(readingId) };
}

/* ---------- follow-up questions on a reading ---------- */

function saveFollowup(readingId, userId, question, answer) {
  run(
    `INSERT INTO followups (reading_id, user_id, question, answer, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [readingId, userId, question, answer, now()]
  );
  return get("SELECT seq AS id FROM sqlite_sequence WHERE name = 'followups'").id;
}

function getFollowups(readingId) {
  return all(
    `SELECT id, question, answer, created_at FROM followups
     WHERE reading_id = ? ORDER BY id ASC`,
    [readingId]
  );
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

/* ---------- 邮箱验证码 ----------
   注册 / 找回密码用。6 位数字，10 分钟有效，一次性使用，
   连续验错 5 次作废。发码频率由 server 层的限流 + 60 秒冷却控制。 */
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

function createEmailCode(email, purpose = "register") {
  email = String(email).trim().toLowerCase();
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const exp = new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString();
  run(
    `INSERT INTO email_codes (email, purpose, code, attempts, expires_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(email, purpose) DO UPDATE SET
       code = excluded.code, attempts = 0,
       expires_at = excluded.expires_at, created_at = excluded.created_at`,
    [email, purpose, code, exp, now()]
  );
  return code;
}

// 上次发码时间（秒级冷却用），没有返回 null。
function emailCodeSentAt(email, purpose = "register") {
  const row = get("SELECT created_at FROM email_codes WHERE email = ? AND purpose = ?",
    [String(email).trim().toLowerCase(), purpose]);
  return row ? row.created_at : null;
}

function verifyEmailCode(email, code, purpose = "register") {
  email = String(email).trim().toLowerCase();
  const row = get("SELECT * FROM email_codes WHERE email = ? AND purpose = ?",
    [email, purpose]);
  if (!row) return { ok: false, error: "请先点击发送验证码。" };
  if (row.expires_at < now()) {
    run("DELETE FROM email_codes WHERE email = ? AND purpose = ?", [email, purpose]);
    return { ok: false, error: "验证码已过期，请重新获取。" };
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    run("DELETE FROM email_codes WHERE email = ? AND purpose = ?", [email, purpose]);
    return { ok: false, error: "尝试次数太多，请重新获取验证码。" };
  }
  if (row.code !== String(code || "").trim()) {
    run("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?",
      [email, purpose]);
    return { ok: false, error: "验证码不对，再检查一下。" };
  }
  // 一次性：验过即删
  run("DELETE FROM email_codes WHERE email = ? AND purpose = ?", [email, purpose]);
  return { ok: true };
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
  // 注册/登录时把游客时期的全部数据并入账号，一条不丢
  run("UPDATE readings SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  run("UPDATE followups SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  run("UPDATE divinations SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  run("UPDATE journal SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  run("UPDATE orders SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  run("UPDATE birth_profiles SET user_id = ? WHERE user_id = ?", [toUserId, fromUserId]);
  const rows = all("SELECT day, count FROM daily_usage WHERE user_id = ?", [fromUserId]);
  for (const r of rows) {
    run(
      `INSERT INTO daily_usage (user_id, day, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET count = count + ?`,
      [toUserId, r.day, r.count, r.count]
    );
  }
  run("DELETE FROM daily_usage WHERE user_id = ?", [fromUserId]);
  // 分享/邀请攒的奖励次数累加
  const from = get("SELECT readings_total, paid_readings, bonus_readings, referred_by FROM users WHERE id = ?", [fromUserId]);
  if (from) {
    run(
      "UPDATE users SET readings_total = readings_total + ?, paid_readings = paid_readings + ?, bonus_readings = bonus_readings + ? WHERE id = ?",
      [from.readings_total || 0, from.paid_readings || 0, from.bonus_readings || 0, toUserId]
    );
    // 游客时期被邀请过、账号没有记录时，继承推荐关系（防重复领取由 applyReferral 兜底）
    if (from.referred_by) {
      run("UPDATE users SET referred_by = COALESCE(referred_by, ?) WHERE id = ?", [from.referred_by, toUserId]);
    }
    run("DELETE FROM users WHERE id = ?", [fromUserId]);
  }
  // 签到记录搬运（主键 user_id+day，账号已有则保留账号的）
  run("INSERT OR IGNORE INTO checkins (user_id, day) SELECT ?, day FROM checkins WHERE user_id = ?",
    [toUserId, fromUserId]);
  run("DELETE FROM checkins WHERE user_id = ?", [fromUserId]);
  // 分享领取记录按天合并
  const grants = all("SELECT day, count FROM share_grants WHERE user_id = ?", [fromUserId]);
  for (const g of grants) {
    run(
      `INSERT INTO share_grants (user_id, day, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET count = count + ?`,
      [toUserId, g.day, g.count, g.count]
    );
  }
  run("DELETE FROM share_grants WHERE user_id = ?", [fromUserId]);
}

/* ---------- divinations (bazi / ziwei / astro) ---------- */

function saveDivination(userId, { kind, input, chartJson, readingText, question }) {
  run(
    `INSERT INTO divinations (user_id, kind, input_json, chart_json, reading_text, question, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, kind, JSON.stringify(input), JSON.stringify(chartJson), readingText, question || "", now()]
  );
  return get("SELECT seq AS id FROM sqlite_sequence WHERE name = 'divinations'").id;
}

function getDivinations(userId, kind, limit = 20) {
  const rows = kind
    ? all(`SELECT id, kind, question, created_at FROM divinations
           WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT ?`, [userId, kind, limit])
    : all(`SELECT id, kind, question, created_at FROM divinations
           WHERE user_id = ? ORDER BY id DESC LIMIT ?`, [userId, limit]);
  return rows;
}

function getDivinationDetail(userId, id) {
  const r = get("SELECT * FROM divinations WHERE id = ? AND user_id = ?", [id, userId]);
  if (!r) return null;
  return { ...r, input: JSON.parse(r.input_json), chart: JSON.parse(r.chart_json),
           input_json: undefined, chart_json: undefined };
}

/* ---------- journal (占卜日记) ---------- */

function saveJournal(userId, { title, content, mood, kind, refId }) {
  const t = now();
  run(
    `INSERT INTO journal (user_id, kind, ref_id, title, content, mood, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, kind || "note", refId || null, title || "", content, mood || "", t, t]
  );
  return get("SELECT seq AS id FROM sqlite_sequence WHERE name = 'journal'").id;
}

function listJournal(userId, limit = 50) {
  return all(
    `SELECT id, kind, ref_id, title, substr(content, 1, 120) AS excerpt,
            mood, created_at, updated_at
     FROM journal WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
}

function getJournalEntry(userId, id) {
  return get("SELECT * FROM journal WHERE id = ? AND user_id = ?", [id, userId]) || null;
}

function updateJournal(userId, id, { title, content, mood }) {
  const row = get("SELECT id FROM journal WHERE id = ? AND user_id = ?", [id, userId]);
  if (!row) return false;
  run("UPDATE journal SET title = ?, content = ?, mood = ?, updated_at = ? WHERE id = ?",
    [title || "", content, mood || "", now(), id]);
  return true;
}

function deleteJournal(userId, id) {
  const row = get("SELECT id FROM journal WHERE id = ? AND user_id = ?", [id, userId]);
  if (!row) return false;
  run("DELETE FROM journal WHERE id = ?", [id]);
  return true;
}

const api = {
  getOrCreateUser,
  setNickname,
  isRegistered,
  freeLeftToday,
  countReadingToday,
  addPaidReadings,
  usePaidReading,
  usePaidReadings,
  getBonusReadings,
  useBonusReadings,
  grantShareBonus,
  shareGrantsLeftToday,
  applyReferral,
  checkinStreak,
  doCheckin,
  saveReading,
  getReadings,
  getReadingDetail,
  saveFollowup,
  getFollowups,
  followupsToday,
  getBirthProfile,
  saveBirthProfile,
  createOrder,
  orderPaid,
  markOrderPaid,
  getStats,
  recentReadings,
  recentUsers,
  // email verification codes
  createEmailCode,
  emailCodeSentAt,
  verifyEmailCode,
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
  // divinations & journal
  saveDivination,
  getDivinations,
  getDivinationDetail,
  saveJournal,
  listJournal,
  getJournalEntry,
  updateJournal,
  deleteJournal,
};

module.exports = { init };
