/* ============================================================
   Moonlit — backend server (Node.js + Express)
   ------------------------------------------------------------
   WHAT IT DOES
   1. Serves your frontend (the tarot website).
   2. Receives a reading request: the user's question + the
      cards they drew.
   3. Builds a prompt, sends it to the AI (Muse or ChatGPT),
      and returns the reading.

   WHY A BACKEND EXISTS
   Your AI API key is like a password that spends money.
   The frontend runs in the visitor's browser — anyone could
   steal a key placed there. So the key lives ONLY here, on
   the server, loaded from a .env file that you never upload
   to GitHub.

   RUN IT
     npm install
     cp .env.example .env        # then put your real key in .env
     npm start                   # open http://localhost:3000
   ============================================================ */

const express = require("express");
const path = require("path");
const helmet = require("helmet");
// Load .env FIRST — everything below reads process.env at startup.
require("dotenv").config();
const { rateLimit, adminBruteForceGuard } = require("./security");
const { isValidUUID, validateReadingInput, validateFollowupInput,
  validateBirthInput, validateJournalInput } = require("./validate");
const { buildReading, calcAstro } = require("./divination");
const { calculateDailyAlmanac } = require("taibu-core/almanac");
const { ragStatus } = require("./ziwei-rag");
// NOTE: the database needs async init (WebAssembly). userdb is assigned
// at the bottom of this file before the server starts listening.
let userdb = null;

/* ---------- admin token: protects /api/admin/* ----------
   Set ADMIN_TOKEN in .env to something only you know.
   Fail-safe: without a token, every admin API returns 503. */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
if (!ADMIN_TOKEN) {
  console.error("❌ ADMIN_TOKEN not set in .env — /api/admin/* is DISABLED.");
}
const adminGuard = adminBruteForceGuard(); // 10 fails / 10 min -> block IP 1 hour

/* ---------- rate limits (per IP) ----------
   reading:   30/hour — bounds your Doubao API bill even if a bot
               mints unlimited anonymous users.
   user/init: 30/hour — slows mass fake-account creation.
   auth:      20/10min — login/register brute-force protection.
   admin:     60/min + the brute-force guard above.
   checkout:  30/min.  notify: 60/min (XorPay retries). */
const readingLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30,
  message: "占卜太频繁了，休息一下再来吧。" });
const initLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30,
  message: "请求太频繁了，稍后再试。" });
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20,
  message: "尝试太频繁，稍后再试。" });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 60,
  message: "请求太频繁了，稍后再试。" });
const checkoutLimiter = rateLimit({ windowMs: 60 * 1000, max: 30,
  message: "请求太频繁了，稍后再试。" });
const notifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 60,
  message: "Too many requests." });
const infoLimiter = rateLimit({ windowMs: 60 * 1000, max: 60,
  message: "请求太频繁了，稍后再试。" });
const shareLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20,
  message: "分享太频繁了，休息一下再来吧。" });
function checkAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: "Admin is not configured." });
  const t = req.query.token || req.headers["x-admin-token"];
  if (t && t === ADMIN_TOKEN) {
    adminGuard.reset(req);
    return next();
  }
  adminGuard.fail(req); // wrong/missing token counts toward a brute-force block
  return res.status(401).json({ error: "Unauthorized." });
}

/* ---------- XorPay (WeChat Pay / Alipay for individuals) ----------
   Sign up at https://xorpay.com, finish 实名审核, get your aid + secret.
   Create a payment: POST https://xorpay.com/api/pay/{aid}
     ?name=...&pay_type=wechat|alipay&price=...&order_id=...&notify_url=...&sign=...
   where sign = md5(name + pay_type + price + order_id + notify_url + secret) */
const crypto = require("crypto");
function xorpaySign(parts, secret) {
  return crypto.createHash("md5").update(parts.join("") + secret, "utf8").digest("hex");
}
function xorpayReady() {
  return !!(process.env.XORPAY_AID && process.env.XORPAY_SECRET);
}

/* ---------- Paid reading packs now live in the database ----------
   users.paid_readings — survives server restarts, tied to the
   visitor's user id instead of their IP address. */

/* ---------- Orders now live in the database (orders table) ---------- */
const PRICE_CNY = parseFloat(process.env.PRICE_CNY || "9.9");
const READINGS_PER_PACK = parseInt(process.env.READINGS_PER_PACK || "10", 10);
/* Charging is OFF by default: everyone gets unlimited free readings.
   Set PAYMENTS_ENABLED=true in .env when you're ready to charge. */
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "true";

const app = express();
/* Behind nginx on this machine: trust X-Forwarded-For only from loopback.
   Direct public connections still use the real socket IP for rate limits. */
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
/* Security headers. CSP is off: /admin.html uses inline scripts. */
app.use(helmet({ contentSecurityPolicy: false }));
/* Body parsers FIRST so every route (incl. payment webhooks) sees req.body.
   200kb cap: readings are small text; huge bodies are rejected. */
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false })); // XorPay notify may be form-encoded

/* XorPay payment notification: XorPay calls this URL after the visitor pays.
   Protection layers:
   1. Refused entirely while PAYMENTS_ENABLED=false.
   2. Callback signature verified with XORPAY_SECRET (fail closed).
   3. Only orders WE created (orders table) can be credited.
   4. markOrderPaid is idempotent: a replayed callback can't double-credit. */
function verifyXorpayNotify(p, secret) {
  // ⚠️ Per XorPay's documented callback format. BEFORE enabling payments,
  // run one real small payment end-to-end and confirm the callback passes.
  // Failed verifications are rejected (logged only) — money is never lost,
  // but the order would need manual review.
  const { aoid, order_id, pay_price, pay_time, sign } = p || {};
  if (!aoid || !order_id || !pay_price || !pay_time || !sign || !secret) return false;
  const expect = crypto.createHash("md5")
    .update(`${aoid}${order_id}${pay_price}${pay_time}${secret}`, "utf8")
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expect));
  } catch {
    return false;
  }
}
app.post("/api/xorpay-notify", notifyLimiter, (req, res) => {
  // Defense in depth: never credit anything while payments are off.
  if (!PAYMENTS_ENABLED || !xorpayReady()) return res.send("ok");
  const p = req.body || {};
  const orderId = p.order_id || p.orderId || p.out_trade_no;
  if (!orderId || !verifyXorpayNotify(p, process.env.XORPAY_SECRET)) {
    console.warn("XorPay notify rejected (bad signature):", orderId || "(no order id)");
    return res.send("ok"); // always "ok" so XorPay stops retrying
  }
  const order = userdb.markOrderPaid(orderId);
  if (order) {
    // Amount sanity: ignore callbacks whose amount doesn't match our order.
    if (p.pay_price && parseFloat(p.pay_price) !== order.amount) {
      console.warn(`XorPay amount mismatch for ${orderId}: got ${p.pay_price}, want ${order.amount}`);
      return res.send("ok");
    }
    if (order.user_id) userdb.addPaidReadings(order.user_id, order.readings);
    console.log(`Order ${orderId} paid — credited ${order.readings} readings to user ${order.user_id}`);
  }
  res.send("ok"); // XorPay expects "ok", otherwise it retries
});

/* The frontend polls this to learn when the QR payment succeeded. */
app.get("/api/order-status", checkoutLimiter, (req, res) => {
  const orderId = req.query.orderId;
  res.json({ paid: !!orderId && userdb.orderPaid(orderId) });
});

// Serve the frontend files
app.use(express.static(path.join(__dirname, "..", "frontend")));

/* ---------- free-reading limit (your first paywall) ----------
   Each visitor (by user id, stored in their browser) gets a few
   free readings per day. After that, the API says "payment required".
   Usage is tracked in the database (daily_usage table). */
/* 每日免费额度：游客 3 次，注册用户 5 次（注册是"更爽"不是"卡脖子"）。
   只有 PAYMENTS_ENABLED=true 时才真正扣额度；现在全免费阶段大家无限玩。 */
const FREE_PER_DAY = parseInt(process.env.FREE_READINGS_PER_DAY || "3", 10); // 游客
const FREE_PER_DAY_MEMBER = parseInt(process.env.FREE_READINGS_PER_DAY_MEMBER || "5", 10); // 注册用户
function dailyQuota(user) {
  return userdb.isRegistered(user.id) ? FREE_PER_DAY_MEMBER : FREE_PER_DAY;
}

/* Token from the Authorization header ("Bearer <token>"). */
function getBearerToken(req) {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/* Resolve the visitor to a user row.
   Logged in (valid token)? -> the account's user row, so readings and
   quota follow the account across devices.
   Otherwise -> the anonymous id from /api/user/init (localStorage). */
function resolveUser(req) {
  const sess = userdb.getSessionAccount(getBearerToken(req));
  if (sess) {
    let u = userdb.getUserForAccount(sess.accountId);
    if (!u) {
      u = userdb.getOrCreateUser(null);
      userdb.attachUserToAccount(u.id, sess.accountId);
    }
    return u;
  }
  const id = (req.body && req.body.userId) || req.headers["x-user-id"] || req.query.userId;
  return userdb.getOrCreateUser(id);
}

/* ---------- user identity ----------
   Called once when the site loads. Returns the visitor's permanent
   anonymous id — the frontend saves it in localStorage. */
app.post("/api/user/init", initLimiter, (req, res) => {
  const user = resolveUser(req);
  // Referral: ?ref=<userId> — newcomer + referrer each earn bonus readings
  // （推荐人是注册用户时双方各 +2，否则 +1）。
  let referralApplied = false, referralReward = 0;
  try {
    const ref = req.body && typeof req.body.ref === "string" ? req.body.ref.trim() : "";
    if (ref) {
      const r = userdb.applyReferral(user.id, ref);
      referralApplied = !!r.applied;
      referralReward = r.rewardAmount || 0;
    }
  } catch (e) { /* referral is best-effort, never blocks init */ }
  res.json({
    userId: user.id,
    isMember: userdb.isRegistered(user.id),
    freePerDay: dailyQuota(user),
    readingsTotal: user.readings_total,
    paidReadings: user.paid_readings,
    bonusReadings: userdb.getBonusReadings(user.id),
    shareGrantsLeft: userdb.shareGrantsLeftToday(user.id),
    referralApplied,
    referralReward,
    freeLeft: userdb.freeLeftToday(user.id, dailyQuota(user)),
    // 注册用户今天是否还有"首次追问免费"（付费开启后才有意义；全免费阶段追问本来就不扣费）
    followupFree: userdb.isRegistered(user.id) && userdb.followupsToday(user.id) === 0,
  });
});

/* ---------- reading history for "我的记录" ---------- */
app.get("/api/user/readings", (req, res) => {
  const user = userdb.getOrCreateUser(req.query.userId);
  // 注册用户历史记录 100 条云同步，游客 30 条。
  const limit = userdb.isRegistered(user.id) ? 100 : 30;
  res.json({ readings: userdb.getReadings(user.id, limit), isMember: userdb.isRegistered(user.id) });
});
app.get("/api/user/reading/:id", (req, res) => {
  const user = userdb.getOrCreateUser(req.query.userId);
  const r = userdb.getReadingDetail(user.id, req.params.id);
  if (!r) return res.status(404).json({ error: "Not found." });
  res.json({ reading: r });
});

/* 命理排盘种类（出生信息记忆接口也要用，所以定义提前） */
const DIVINATION_KINDS = ["bazi", "ziwei", "astro"];
const DIVINATION_NAMES = { bazi: "八字命盘", ziwei: "紫微斗数", astro: "西方星盘" };

/* ---------- email accounts: register / login / logout ----------
   Passwords are hashed with scrypt (Node built-in crypto).
   The frontend stores the session token in localStorage and sends it
   as "Authorization: Bearer <token>". Login merges this device's
   anonymous history into the account, so nothing is lost. */


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/auth/register", authLimiter, (req, res) => {
  const { email, password, userId } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ error: "请输入有效的邮箱地址。" });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "密码至少 6 位。" });
  }
  const acc = userdb.createAccount(email, String(password));
  if (acc.error === "exists") {
    return res.status(409).json({ error: "这个邮箱已经注册过了，直接登录吧。" });
  }
  // Attach this device's anonymous history to the new account.
  const user = userdb.getOrCreateUser(userId);
  userdb.attachUserToAccount(user.id, acc.id);
  const token = userdb.createSession(acc.id);
  res.json({ token, email: acc.email, userId: user.id });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { email, password, userId } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "请输入邮箱和密码。" });
  }
  const acc = userdb.getAccountByEmail(email);
  if (!acc || !userdb.verifyPassword(String(password), acc.password_hash)) {
    return res.status(401).json({ error: "邮箱或密码不对，再试试。" });
  }
  let user = userdb.getUserForAccount(acc.id);
  if (!user) {
    user = userdb.getOrCreateUser(null);
    userdb.attachUserToAccount(user.id, acc.id);
  }
  // Merge this device's anonymous history into the account.
  if (userId && userId !== user.id) userdb.mergeUsers(userId, user.id);
  const token = userdb.createSession(acc.id);
  res.json({ token, email: acc.email, userId: user.id });
});

app.post("/api/auth/logout", (req, res) => {
  userdb.deleteSession(getBearerToken(req));
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const sess = userdb.getSessionAccount(getBearerToken(req));
  if (!sess) return res.status(401).json({ error: "Not logged in." });
  let user = userdb.getUserForAccount(sess.accountId);
  if (!user) {
    user = userdb.getOrCreateUser(null);
    userdb.attachUserToAccount(user.id, sess.accountId);
  }
  res.json({ email: sess.email, userId: user.id });
});

/* ---------- 出生信息记忆（注册用户专享） ----------
   保存八字/紫微/星盘的出生信息，下次一键填入。只认登录态（Bearer token），
   游客调这个接口会 401。字段走 validateBirthInput 校验，和排盘同一套规则。 */
app.get("/api/profile/birth", (req, res) => {
  const sess = userdb.getSessionAccount(getBearerToken(req));
  if (!sess) return res.status(401).json({ error: "登录后可使用出生信息记忆。" });
  const user = userdb.getUserForAccount(sess.accountId);
  res.json({ profile: user ? userdb.getBirthProfile(user.id) : null });
});

app.post("/api/profile/birth", infoLimiter, (req, res) => {
  const sess = userdb.getSessionAccount(getBearerToken(req));
  if (!sess) return res.status(401).json({ error: "登录后可保存出生信息。" });
  const kind = (req.body && req.body.kind) || "bazi";
  if (!DIVINATION_KINDS.includes(kind)) return res.status(400).json({ error: "没有这种排盘。" });
  const v = validateBirthInput(req.body, { needLocation: kind === "astro" });
  if (!v.ok) return res.status(400).json({ error: v.error });
  let user = userdb.getUserForAccount(sess.accountId);
  if (!user) {
    user = userdb.getOrCreateUser(null);
    userdb.attachUserToAccount(user.id, sess.accountId);
  }
  userdb.saveBirthProfile(user.id, { ...v.clean, kind });
  res.json({ ok: true });
});

/* ---------- admin dashboard (token protected) ----------
   Open /admin.html on your server and enter your ADMIN_TOKEN. */
app.get("/api/admin/stats", adminLimiter, adminGuard.check, checkAdmin, (req, res) => {
  res.json(userdb.getStats());
});
app.get("/api/admin/recent", adminLimiter, adminGuard.check, checkAdmin, (req, res) => {
  res.json({
    readings: userdb.recentReadings(20),
    users: userdb.recentUsers(20),
  });
});

/* ============================================================
   THE PROMPT — this is your real product.
   The AI is only as good as the instructions you give it.
   Tips: give it a role, the exact cards, the question, and the
   shape you want the answer in. Tune this text and watch how
   the readings change — that tuning IS the business skill.
   ============================================================ */
function buildPrompt(question, spreadName, cards) {
  const cardLines = cards
    .map(
      (c) =>
        `- ${c.position}: ${c.name}（${c.orientation === "reversed" ? "逆位" : "正位"}）。传统牌义：${c.meaning}`
    )
    .join("\n");
  // Bigger spreads need more room: 10 cards can't fit in 300 characters.
  const lenHint = cards.length >= 10 ? "约 550-750 字" : "约 250-350 字";

  return `你是"月光塔罗"（Moonlit），一位有 20 年经验、温暖而深刻的塔罗占卜师。\
你说话温柔、直接、像朋友一样 — 从不说空话套话。

求问者问："${question}"
牌阵：${spreadName}
抽到的牌：
${cardLines}

请用简体中文写一段个人化的塔罗解读（${lenHint}）：
1. 开头用一句话共情他的问题。
2. 结合牌位，逐张解读每张牌，并紧扣他的具体问题。
3. 把牌编织成一个连贯的故事 — 展现它们之间的关联。
4. 结尾给出清晰、温暖、可执行的建议：这周可以做的一件事。
5. 绝不透露你是 AI。不给医疗、法律、投资建议；涉及健康请建议咨询专业人士。`;
}

/* ---------- follow-up prompt: answer ONE more question about a past reading ----------
   The full context (cards + original interpretation + earlier follow-ups)
   comes from OUR database, keyed by reading id — the client only sends
   the id and the new question, so nothing here can be forged. */
function buildFollowupPrompt(reading, question) {
  const cardLines = reading.cards
    .map(
      (c) =>
        `- ${c.position}: ${c.name}（${c.orientation === "reversed" ? "逆位" : "正位"}）。传统牌义：${c.meaning}`
    )
    .join("\n");
  const prev = (reading.followups || [])
    .map((f) => `追问：${f.question}\n你的回答：${f.answer}`)
    .join("\n\n");

  return `你是"月光塔罗"（Moonlit），一位有 20 年经验、温暖而深刻的塔罗占卜师。\
你说话温柔、直接、像朋友一样 — 从不说空话套话。

这次占卜的完整记录：
求问者最初的问题："${reading.question}"
牌阵：${reading.spread || "塔罗牌阵"}
抽到的牌：
${cardLines}

你之前的解读：
${reading.reading_text}
${prev ? "\n之前的追问：\n" + prev + "\n" : ""}
求问者现在追问："${question}"

请用简体中文回答这次追问（150-250 字）：紧扣牌面和你之前的解读，只回答他这次问的，\
不要把整段解读重复一遍。结尾可以给一句小建议。\
绝不透露你是 AI。不给医疗、法律、投资建议；涉及健康请建议咨询专业人士。`;
}

/* ---------- call the AI ---------- */
async function askAI(prompt) {
  const provider = (process.env.AI_PROVIDER || "doubao").toLowerCase();

  /* Doubao (ByteDance) via Volcengine — OpenAI-compatible API.
     Get a key: https://console.volcengine.com → 开通豆包大模型 → 方舟 → API Key 管理.
     Model IDs look like doubao-seed-1-6-250615
     (or doubao-seed-1-6-flash-250615 for faster + cheaper). */
  if (provider === "doubao") {
    const key = process.env.DOUBAO_API_KEY;
    if (!key) throw new Error("Missing DOUBAO_API_KEY in .env");
    const model = process.env.DOUBAO_MODEL || "doubao-seed-1-6-250615";
    const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(45000), // never hang forever if the AI API stalls
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.9,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Doubao API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (provider === "openai") {
    // ---- ChatGPT (OpenAI) ----
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // cheap + good enough for readings
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
    });
    if (!res.ok) throw new Error("OpenAI error " + res.status);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  // ---- Muse (Anthropic) — default ----
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", // cheap + fast, great for readings
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error("Anthropic error " + res.status);
  const data = await res.json();
  return data.content[0].text.trim();
}

/* ---------- the reading endpoint ---------- */
app.post("/api/reading", readingLimiter, async (req, res) => {
  try {
    // Never trust the client: validate everything, and rebuild card
    // names/meanings from OUR data (looked up by card id) so a forged
    // request can't inject instructions into the AI prompt.
    const v = validateReadingInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { question, spread, cards } = v.clean;

    // --- payment check (skipped while PAYMENTS_ENABLED=false: free for all) ---
    // Celtic Cross (10 cards) costs 2 quota: it burns ~3x the AI tokens.
    const user = resolveUser(req);
    const cost = cards.length >= 10 ? 2 : 1;
    let usedPaidPack = false, usedBonus = false;
    if (PAYMENTS_ENABLED) {
      if (userdb.usePaidReadings(user.id, cost)) {
        usedPaidPack = true; // they bought readings — let them in
      } else if (userdb.useBonusReadings(user.id, cost)) {
        usedBonus = true; // 分享赚来的免费次数
      } else if (userdb.freeLeftToday(user.id, dailyQuota(user)) < cost) {
        // No paid readings and no free readings left -> paywall
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
          userId: user.id,
        });
      }
    }

    const prompt = buildPrompt(question, spread || "Tarot spread", cards);
    const reading = await askAI(prompt);

    // --- save to the user's history + count today's usage ---
    const readingId = userdb.saveReading(user.id, {
      question, spread: spread || "Tarot spread", cards, readingText: reading,
    });
    if (!usedPaidPack && !usedBonus) userdb.countReadingToday(user.id, cost);

    res.json({
      reading,
      readingId,
      userId: user.id,
      freeLeft: userdb.freeLeftToday(user.id, dailyQuota(user)),
    });
  } catch (err) {
    console.error("Reading failed:", err.message);
    res.status(500).json({ error: "The AI could not answer right now. Try again." });
  }
});

/* ---------- follow-up question on a previous reading ----------
   Body: { userId, readingId, question }
   The reading (cards, interpretation, earlier follow-ups) is loaded
   from OUR database and must belong to this user — the client can't
   forge context. Each follow-up costs 1 quota, same as a reading. */
app.post("/api/reading/followup", readingLimiter, async (req, res) => {
  try {
    const v = validateFollowupInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { readingId, question } = v.clean;

    const user = resolveUser(req);
    const reading = userdb.getReadingDetail(user.id, readingId);
    if (!reading) {
      return res.status(404).json({ error: "找不到这次解读，请重新占卜。" });
    }

    // Same quota rules as a reading (skipped while PAYMENTS_ENABLED=false).
    // 注册用户每天首次追问免费（追问 prompt 短、成本低，当会员小福利）。
    let usedPaidPack = false, usedBonus = false, usedFreeFollowup = false;
    if (PAYMENTS_ENABLED) {
      if (userdb.isRegistered(user.id) && userdb.followupsToday(user.id) === 0) {
        usedFreeFollowup = true;
      } else if (userdb.usePaidReadings(user.id, 1)) {
        usedPaidPack = true;
      } else if (userdb.useBonusReadings(user.id, 1)) {
        usedBonus = true; // 分享赚来的免费次数
      } else if (userdb.freeLeftToday(user.id, dailyQuota(user)) < 1) {
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
          userId: user.id,
        });
      }
    }

    const prompt = buildFollowupPrompt(reading, question);
    const answer = await askAI(prompt);

    userdb.saveFollowup(reading.id, user.id, question, answer);
    if (!usedPaidPack && !usedBonus && !usedFreeFollowup) userdb.countReadingToday(user.id, 1);

    res.json({
      answer,
      freeFollowupUsed: usedFreeFollowup,
      freeLeft: userdb.freeLeftToday(user.id, dailyQuota(user)),
    });
  } catch (err) {
    console.error("Follow-up failed:", err.message);
    res.status(500).json({ error: "The AI could not answer right now. Try again." });
  }
});

/* ---------- 命理排盘: 八字 / 紫微斗数 / 西方星盘 ----------
   POST /api/divination/:kind  (kind = bazi | ziwei | astro)
   Body: { gender, birthYear, birthMonth, birthDay, birthHour,
           birthMinute?, calendarType?, isLeapMonth?, question?,
           latitude?, longitude?, birthPlace? (astro only) }
   The chart is calculated by OUR code (taibu-core, MIT) from validated
   birth data — the client can never inject prompt text through it.
   Each reading costs 1 quota, same as a tarot reading. */

app.post("/api/divination/:kind", readingLimiter, async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!DIVINATION_KINDS.includes(kind)) {
      return res.status(404).json({ error: "没有这种排盘。" });
    }
    const v = validateBirthInput(req.body, { needLocation: kind === "astro" });
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { question, ...calcInput } = v.clean;

    // Same quota rules as tarot (skipped while PAYMENTS_ENABLED=false).
    const user = resolveUser(req);
    let usedPaidPack = false, usedBonus = false;
    if (PAYMENTS_ENABLED) {
      if (userdb.usePaidReadings(user.id, 1)) {
        usedPaidPack = true;
      } else if (userdb.useBonusReadings(user.id, 1)) {
        usedBonus = true; // 分享赚来的免费次数
      } else if (userdb.freeLeftToday(user.id, dailyQuota(user)) < 1) {
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
          userId: user.id,
        });
      }
    }

    const { chartJson, prompt, extra } = buildReading(kind, calcInput, question);
    const reading = await askAI(prompt);

    const id = userdb.saveDivination(user.id, {
      kind, input: calcInput, chartJson, readingText: reading, question,
    });
    if (!usedPaidPack && !usedBonus) userdb.countReadingToday(user.id, 1);

    res.json({ id, kind, name: DIVINATION_NAMES[kind], chart: chartJson, reading,
               extra: kind === "astro" ? extra : undefined,
               freeLeft: userdb.freeLeftToday(user.id, dailyQuota(user)) });
  } catch (err) {
    console.error("Divination failed:", err.message);
    res.status(500).json({ error: "排盘失败，请稍后再试。" });
  }
});

/* Divination history (per kind, or all). */
app.get("/api/divination/history", (req, res) => {
  const user = resolveUser(req);
  const kind = DIVINATION_KINDS.includes(req.query.kind) ? req.query.kind : null;
  res.json({ items: userdb.getDivinations(user.id, kind) });
});

app.get("/api/divination/:kind/:id", (req, res) => {
  const kind = req.params.kind;
  if (!DIVINATION_KINDS.includes(kind)) return res.status(404).json({ error: "没有这种排盘。" });
  const user = resolveUser(req);
  const d = userdb.getDivinationDetail(user.id, Number(req.params.id));
  if (!d || d.kind !== kind) return res.status(404).json({ error: "找不到这次排盘。" });
  if (kind === "astro") d.extra = calcAstro(d.input).extra; // geometry for the wheel
  res.json(d);
});

/* ---------- 占卜日记 ----------
   Private notes: linked to a tarot/divination reading or standalone.
   All endpoints are scoped to the caller's user id. */
app.get("/api/journal", (req, res) => {
  const user = resolveUser(req);
  res.json({ items: userdb.listJournal(user.id) });
});

app.post("/api/journal", readingLimiter, (req, res) => {
  const v = validateJournalInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const user = resolveUser(req);
  const id = userdb.saveJournal(user.id, v.clean);
  res.json({ id });
});

app.get("/api/journal/:id", (req, res) => {
  const user = resolveUser(req);
  const e = userdb.getJournalEntry(user.id, Number(req.params.id));
  if (!e) return res.status(404).json({ error: "找不到这篇日记。" });
  res.json(e);
});

app.put("/api/journal/:id", (req, res) => {
  const v = validateJournalInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const user = resolveUser(req);
  const ok = userdb.updateJournal(user.id, Number(req.params.id), v.clean);
  if (!ok) return res.status(404).json({ error: "找不到这篇日记。" });
  res.json({ ok: true });
});

app.delete("/api/journal/:id", (req, res) => {
  const user = resolveUser(req);
  const ok = userdb.deleteJournal(user.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "找不到这篇日记。" });
  res.json({ ok: true });
});

/* ---------- 今日黄历 ----------
   GET /api/almanac?date=YYYY-MM-DD （默认北京时间今天）
   免费公开信息：农历、干支、宜忌、冲煞、财神方位、时辰吉凶。
   数据来自 taibu-core 的传统黄历引擎，按日期缓存。 */
const almanacCache = new Map(); // date -> slim almanac JSON (static per date)
function beijingToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}
function slimAlmanac(full) {
  const a = full.almanac || {};
  return {
    date: full.date,
    ganzhi: (full.dayInfo && full.dayInfo.ganZhi) || "",
    lunar: a.lunarDate || "",
    zodiac: a.zodiac || "",
    suitable: a.suitable || [],
    avoid: a.avoid || [],
    chongSha: a.chongSha || "",
    pengZu: a.pengZuBaiJi || "",
    taiShen: a.taiShen || "",
    directions: {
      caiShen: (a.directions && a.directions.caiShen) || "",
      xiShen: (a.directions && a.directions.xiShen) || "",
    },
    dayOfficer: a.dayOfficer || "",
    tianShen: a.tianShen || "",
    tianShenLuck: a.tianShenLuck || "",
    lunarMansion: a.lunarMansion || "",
    lunarMansionLuck: a.lunarMansionLuck || "",
    nayin: a.nayin || "",
    hours: (a.hourlyFortune || []).map((h) => ({
      ganZhi: h.ganZhi, luck: h.tianShenLuck, god: h.tianShen,
    })),
  };
}
app.get("/api/almanac", infoLimiter, async (req, res) => {
  try {
    let date = (req.query.date || "").trim() || beijingToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "日期格式应为 YYYY-MM-DD。" });
    }
    if (date < "2020-01-01" || date > "2035-12-31") {
      return res.status(400).json({ error: "日期超出范围。" });
    }
    const d = new Date(date + "T12:00:00");
    if (isNaN(d.getTime())) return res.status(400).json({ error: "无效的日期。" });
    if (almanacCache.has(date)) return res.json(almanacCache.get(date));
    const full = await calculateDailyAlmanac({ date });
    const slim = slimAlmanac(full);
    if (almanacCache.size > 60) almanacCache.clear();
    almanacCache.set(date, slim);
    res.json(slim);
  } catch (err) {
    console.error("Almanac failed:", err.message);
    res.status(500).json({ error: "黄历加载失败，请稍后再试。" });
  }
});

/* ---------- 分享赚免费次数 ----------
   POST /api/share-grant  →  每天最多 2 次（会员 3 次），每次 +1 bonus_readings。
   bonus 在付费开启后按 免费→bonus→付费包 的顺序抵扣。
   领取需要登录：奖励次数是注册用户的福利，游客分享欢迎，但领奖先注册。 */
app.post("/api/share-grant", shareLimiter, (req, res) => {
  try {
    const user = resolveUser(req);
    if (!userdb.isRegistered(user.id)) {
      return res.status(401).json({ error: "登录后分享可领取奖励次数，注册只要 10 秒 👑", needLogin: true });
    }
    const r = userdb.grantShareBonus(user.id);
    res.json({ userId: user.id, ...r });
  } catch (err) {
    console.error("Share grant failed:", err.message);
    res.status(500).json({ error: "领取失败，请稍后再试。" });
  }
});
app.get("/api/share-status", (req, res) => {
  const user = resolveUser(req);
  res.json({
    userId: user.id,
    bonus: userdb.getBonusReadings(user.id),
    grantsLeft: userdb.shareGrantsLeftToday(user.id),
  });
});

/* ---------- 每日签到 ----------
   POST /api/checkin → { ok, streak, checkedInToday, rewardGranted }
   GET  /api/checkin/status → { streak, checkedInToday }
   签到需要登录：连续签到是注册用户的回访福利，游客先注册再签到。 */
app.post("/api/checkin", infoLimiter, (req, res) => {
  try {
    const user = resolveUser(req);
    if (!userdb.isRegistered(user.id)) {
      return res.status(401).json({ error: "登录后签到，连续 7 天得免费解读，签到记录云同步不丢失 👑", needLogin: true });
    }
    res.json({ userId: user.id, ...userdb.doCheckin(user.id) });
  } catch (err) {
    console.error("Checkin failed:", err.message);
    res.status(500).json({ error: "签到失败，请稍后再试。" });
  }
});
app.get("/api/checkin/status", (req, res) => {
  try {
    const user = resolveUser(req);
    res.json({ userId: user.id, ...userdb.checkinStreak(user.id) });
  } catch (err) {
    res.status(500).json({ error: "加载失败。" });
  }
});
/* ---------- XorPay checkout: visitor pays ¥9.9 once ----------
   Body: { method: "wechat" | "alipay" }
   Creates an order at XorPay and returns a QR code for the visitor to scan
   with WeChat / Alipay. The frontend polls /api/order-status until paid,
   then XorPay's notify credits the buyer automatically. */
app.post("/api/checkout", checkoutLimiter, async (req, res) => {
  if (!PAYMENTS_ENABLED) {
    return res.status(403).json({ error: "Payments are disabled." });
  }
  if (!xorpayReady()) {
    return res.status(500).json({ error: "Payments are not configured yet." });
  }
  const payType = req.body && req.body.method === "alipay" ? "alipay" : "wechat";
  const orderId = "moonlit-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const user = resolveUser(req); // link the order to this visitor
  const name = `Moonlit ${READINGS_PER_PACK} Tarot Readings`;
  const notifyUrl = (process.env.BASE_URL || "").replace(/\/$/, "") + "/api/xorpay-notify";
  const price = PRICE_CNY.toFixed(2);
  const sign = xorpaySign([name, payType, price, orderId, notifyUrl], process.env.XORPAY_SECRET);
  const params = new URLSearchParams({
    name, pay_type: payType, price, order_id: orderId, notify_url: notifyUrl, sign,
  });
  const url = `https://xorpay.com/api/pay/${process.env.XORPAY_AID}?${params.toString()}`;
  try {
    const r = await fetch(url, { method: "POST" });
    const data = await r.json();
    console.log("XorPay create-order response:", JSON.stringify(data).slice(0, 500));
    userdb.createOrder(orderId, user.id, parseFloat(price), READINGS_PER_PACK);
    res.json({ orderId, price, xorpayload: data, qr: extractQr(data) });
  } catch (err) {
    console.error("XorPay checkout failed:", err.message);
    res.status(500).json({ error: "Could not start checkout." });
  }
});

/* XorPay's QR field name may vary — check common shapes.
   The raw response is always returned (and logged) so you can adjust. */
function extractQr(data) {
  if (!data || typeof data !== "object") return null;
  const info = data.info || data.data || {};
  const candidates = [
    data.qr_url, data.qrUrl, data.qr, data.code_url,
    info.qr_url, info.qrUrl, info.qr, info.code_url, info.image,
  ];
  const hit = candidates.find((v) => typeof v === "string" && v.length > 0);
  if (!hit) return null;
  return { type: hit.startsWith("http") ? "image" : "data", value: hit };
}

/* Unknown API routes -> JSON 404 (not Express's HTML page). */
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

/* Last resort: log the real error on the server, send visitors a safe message.
   Never leaks stack traces, file paths, keys, or DB details. */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err && err.message ? err.message : err);
  res.status(500).json({ error: "服务器开小差了，稍后再试。" });
});

const PORT = process.env.PORT || 3000;
// The DB (sql.js WebAssembly) must finish loading before we accept requests.
require("./db").init().then((api) => {
  userdb = api;
  app.listen(PORT, () => {
    console.log(`🌙 Moonlit running at http://localhost:${PORT}`);
    console.log(`   AI provider: ${process.env.AI_PROVIDER || "doubao"}`);
    console.log(`   Free readings/day: guest ${FREE_PER_DAY}, member ${FREE_PER_DAY_MEMBER}`);
    console.log(`   XorPay: ${xorpayReady() ? "connected" : "not configured"}`);
    console.log(`   Payments: ${PAYMENTS_ENABLED ? `ON — ¥${PRICE_CNY} for ${READINGS_PER_PACK} readings` : "OFF (free for everyone)"}`);
  });
}).catch((e) => {
  console.error("❌ Database failed to start:", e);
  process.exit(1);
});
