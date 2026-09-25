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
const VALID_CARD_COUNTS = [1, 3, 5];

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
    });
  }

  return { ok: true, clean: { question: q, spread: spreadName, cards: cleanCards } };
}

module.exports = { isValidUUID, validateReadingInput, MAX_QUESTION };
