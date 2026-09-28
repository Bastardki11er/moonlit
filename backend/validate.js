/* ============================================================
   Moonlit — input validation (unit-testable, no side effects)
   ------------------------------------------------------------
   The frontend is never trusted: anyone can curl the API with
   forged data. Two things matter here:

   1. The AI prompt must not contain attacker-controlled text
      except the user's question (length-capped). Card names and
      meanings ALWAYS come from our own card data, looked up by
      card id — never from the request body. This kills prompt
      injection through forged "cards".
   2. Anonymous user ids must look like the UUIDs we issue.
      Anything else is treated as "no id" (a fresh user is
      created) instead of creating junk rows in the database.
   ============================================================ */

const TAROT_CARDS = require("../frontend/js/cards.js");
const CARD_MAP = new Map(TAROT_CARDS.map((c) => [c.id, c]));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

const MAX_QUESTION = 500;
const VALID_CARD_COUNTS = [1, 3, 5, 10]; // 10 = Celtic Cross
const VALID_SPREAD_KEYS = ["single", "love", "career", "fortune", "celtic"];
const VALID_LANGS = ["zh", "en"];

/* Language requested by the client ("zh" default). Only ever "zh"|"en". */
function cleanLang(body) {
  const l = body && typeof body.lang === "string" ? body.lang.trim().toLowerCase() : "";
  return VALID_LANGS.includes(l) ? l : "zh";
}

/* Spread key (stable id like "love"); null when missing/invalid. */
function cleanSpreadKey(body) {
  const k = body && typeof body.spreadKey === "string" ? body.spreadKey.trim() : "";
  return VALID_SPREAD_KEYS.includes(k) ? k : null;
}

/* Validate a POST /api/reading body.
   Returns { ok: true, clean } or { ok: false, error }. */
function validateReadingInput(body) {
  const { question, spread, cards } = body || {};

  const q = typeof question === "string" ? question.trim() : "";
  if (!q) return { ok: false, error: "请先写下你的问题。" };
  if (q.length > MAX_QUESTION) {
    return { ok: false, error: `问题太长了，请控制在 ${MAX_QUESTION} 字以内。` };
  }

  // Spread is display-only text; keep it short and harmless.
  const spreadName =
    typeof spread === "string" && spread.trim() ? spread.trim().slice(0, 40) : "单张牌";

  if (!Array.isArray(cards) || !VALID_CARD_COUNTS.includes(cards.length)) {
    return { ok: false, error: "抽牌数据不对，请重新抽牌。" };
  }

  const cleanCards = [];
  for (const c of cards) {
    if (!c || typeof c !== "object") {
      return { ok: false, error: "抽牌数据不对，请重新抽牌。" };
    }
    const def = CARD_MAP.get(c.id);
    if (!def) {
      return { ok: false, error: "抽牌数据不对，请重新抽牌。" };
    }
    if (c.orientation !== "upright" && c.orientation !== "reversed") {
      return { ok: false, error: "抽牌数据不对，请重新抽牌。" };
    }
    cleanCards.push({
      id: def.id,
      name: def.name, // from OUR data, never from the client
      position: typeof c.position === "string" ? c.position.slice(0, 40) : "",
      orientation: c.orientation,
      meaning: c.orientation === "reversed" ? def.reversed : def.upright,
      meaning_en: c.orientation === "reversed"
        ? (def.reversed_en || def.reversed)
        : (def.upright_en || def.upright),
    });
  }

  return { ok: true, clean: {
    question: q, spread: spreadName, spreadKey: cleanSpreadKey(body),
    lang: cleanLang(body), cards: cleanCards,
  } };
}

/* Validate a POST /api/reading/followup body.
   Returns { ok: true, clean } or { ok: false, error }. */
function validateFollowupInput(body) {
  const { readingId, question } = body || {};

  const rid = Number(readingId);
  if (!Number.isInteger(rid) || rid <= 0) {
    return { ok: false, error: "找不到这次解读，请重新占卜。" };
  }

  const q = typeof question === "string" ? question.trim() : "";
  if (!q) return { ok: false, error: "请先写下你想追问的问题。" };
  if (q.length > MAX_QUESTION) {
    return { ok: false, error: `问题太长了，请控制在 ${MAX_QUESTION} 字以内。` };
  }

  return { ok: true, clean: { readingId: rid, question: q } };
}

/* (exports are at the bottom of the file) */

/* ---------- divination (bazi / ziwei / astro) ---------- */

function numIn(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : null;
}

/* Validate birth data shared by bazi / ziwei / western astrology.
   Frontend sends gender as 'male'|'female' (mapped from the Chinese UI labels).
   Returns { ok, clean } where clean fits taibu-core's BirthTimeInput. */
function validateBirthInput(body) {
  const b = body || {};
  const gender = b.gender === "female" ? "female" : b.gender === "male" ? "male" : null;
  if (!gender) return { ok: false, error: "请选择性别。" };

  const year = numIn(b.birthYear, 1900, 2026);
  const month = numIn(b.birthMonth, 1, 12);
  const day = numIn(b.birthDay, 1, 31);
  const hour = numIn(b.birthHour, 0, 23);
  if (year === null || month === null || day === null || hour === null) {
    return { ok: false, error: "出生日期时间不对，请检查。" };
  }
  // Real calendar check (Feb 30 etc.).
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { ok: false, error: "这个日期不存在，请检查。" };
  }
  const minute = b.birthMinute === undefined || b.birthMinute === "" ? 0 : numIn(b.birthMinute, 0, 59);
  if (minute === null) return { ok: false, error: "出生分钟不对，请检查。" };

  const calendarType = b.calendarType === "lunar" ? "lunar" : "solar";
  const isLeapMonth = b.isLeapMonth === true;

  const q = typeof b.question === "string" ? b.question.trim() : "";
  if (q.length > MAX_QUESTION) {
    return { ok: false, error: `问题太长了，请控制在 ${MAX_QUESTION} 字以内。` };
  }

  const clean = {
    gender, birthYear: year, birthMonth: month, birthDay: day,
    birthHour: hour, birthMinute: minute,
    calendarType, isLeapMonth, question: q,
  };

  return { ok: true, clean };
}

/* ---------- journal ---------- */

const JOURNAL_MOODS = ["开心", "平静", "迷茫", "难过", "期待", "感恩"];
const JOURNAL_KINDS = ["note", "tarot", "bazi", "ziwei", "astro"];

function validateJournalInput(body) {
  const b = body || {};
  const content = typeof b.content === "string" ? b.content.trim() : "";
  if (!content) return { ok: false, error: "日记内容不能为空。" };
  if (content.length > 5000) return { ok: false, error: "日记太长了，请控制在 5000 字以内。" };
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 60) : "";
  const mood = JOURNAL_MOODS.includes(b.mood) ? b.mood : "";
  const kind = JOURNAL_KINDS.includes(b.kind) ? b.kind : "note";
  let refId = null;
  if (b.refId !== undefined && b.refId !== null && b.refId !== "") {
    const n = Number(b.refId);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "关联的解读找不到了。" };
    refId = n;
  }
  return { ok: true, clean: { title, content, mood, kind, refId } };
}

module.exports = { isValidUUID, validateReadingInput, validateFollowupInput, MAX_QUESTION,
  validateBirthInput, validateJournalInput, JOURNAL_MOODS,
  cleanLang, cleanSpreadKey, VALID_SPREAD_KEYS };
