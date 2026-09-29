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
  validateBirthInput, validateJournalInput, validateFeedbackInput, cleanLang, VALID_SPREAD_KEYS } = require("./validate");
const { buildReading, calcAstro } = require("./divination");
const { calculateDailyAlmanac } = require("taibu-core/almanac");
const { ragStatus } = require("./ziwei-rag");
const emailer = require("./email");
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
// verification codes: 5/min/IP + 60s cooldown per email (stops email-bombing)
const codeLimiter = rateLimit({ windowMs: 60 * 1000, max: 5,
  message: "发送太频繁了，稍后再试。" });
// user feedback: guests allowed, strict cap to stop spam
const feedbackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5,
  message: "提交太频繁了，稍后再试。" });
const CODE_RESEND_COOLDOWN_MS = 60 * 1000;
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
   Sign up at https://xorpay.com, finish real-name verification, get your aid + secret.
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
/* Daily free quota: 3 for guests, 5 for members (registering is "nicer", not a paywall).
   Quotas are only actually enforced when PAYMENTS_ENABLED=true; while everything is free, usage is unlimited. */
const FREE_PER_DAY = parseInt(process.env.FREE_READINGS_PER_DAY || "3", 10); // guests
const FREE_PER_DAY_MEMBER = parseInt(process.env.FREE_READINGS_PER_DAY_MEMBER || "5", 10); // members
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
  // (both sides get +2 when the referrer is a member, otherwise +1).
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
    // whether the member still has their free first follow-up today (only matters once payments are on; follow-ups are free while everything is)
    followupFree: userdb.isRegistered(user.id) && userdb.followupsToday(user.id) === 0,
  });
});

/* ---------- reading history for "my records" ---------- */
app.get("/api/user/readings", (req, res) => {
  const user = userdb.getOrCreateUser(req.query.userId);
  // members get 100 history entries synced to the cloud; guests get 30.
  const limit = userdb.isRegistered(user.id) ? 100 : 30;
  res.json({ readings: userdb.getReadings(user.id, limit), isMember: userdb.isRegistered(user.id) });
});
app.get("/api/user/reading/:id", (req, res) => {
  const user = userdb.getOrCreateUser(req.query.userId);
  const r = userdb.getReadingDetail(user.id, req.params.id);
  if (!r) return res.status(404).json({ error: "Not found." });
  res.json({ reading: r });
});

/* chart reading types (also used by the birth-profile endpoints, so defined early) */
const DIVINATION_KINDS = ["bazi", "ziwei", "astro"];
const DIVINATION_NAMES = { bazi: "八字命盘", ziwei: "紫微斗数", astro: "西方星盘" };

/* ---------- email accounts: register / login / logout ----------
   Passwords are hashed with scrypt (Node built-in crypto).
   The frontend stores the session token in localStorage and sends it
   as "Authorization: Bearer <token>". Login merges this device's
   anonymous history into the account, so nothing is lost. */


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- email verification codes ----------
   POST /api/auth/send-code { email, purpose } → sends a 6-digit code.
   purpose currently only supports "register"; "reset" (password reset) comes later.
   Without SMTP configured it runs in dev mode: codes go to the server console, no real emails. */
app.post("/api/auth/send-code", codeLimiter, async (req, res) => {
  const { email, purpose } = req.body || {};
  const p = purpose || "register";
  if (!email || !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ error: "请输入有效的邮箱地址。" });
  }
  if (p !== "register") {
    return res.status(400).json({ error: "不支持的用途。" });
  }
  const mail = String(email).trim().toLowerCase();
  if (userdb.getAccountByEmail(mail)) {
    return res.status(400).json({ error: "这个邮箱已经注册过了，直接登录吧。" });
  }
  // one code per email per 60 seconds
  const last = userdb.emailCodeSentAt(mail, p);
  if (last && Date.now() - new Date(last).getTime() < CODE_RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: "验证码刚发过，60 秒后再试。" });
  }
  const code = userdb.createEmailCode(mail, p);
  try {
    await emailer.sendEmailCode(mail, code);
  } catch (e) {
    console.error("send email code failed:", e.message);
    return res.status(500).json({ error: "邮件发送失败，请稍后重试。" });
  }
  res.json({ ok: true, dev: !emailer.isConfigured() });
});

app.post("/api/auth/register", authLimiter, (req, res) => {
  const { email, password, userId, code } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ error: "请输入有效的邮箱地址。" });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "密码至少 6 位。" });
  }
  // code is required: voided after verification, one-time use
  const v = userdb.verifyEmailCode(String(email), code, "register");
  if (!v.ok) {
    return res.status(400).json({ error: v.error });
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

/* ---------- saved birth profiles (members only) ----------
   Saves the birth info used for bazi/ziwei/astro readings so it can be re-filled in one tap. Login required (Bearer token), 
   guests hitting this endpoint get 401. Fields are validated with validateBirthInput — same rules as the readings. */
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
  const v = validateBirthInput(req.body);
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
app.get("/api/admin/feedback", adminLimiter, adminGuard.check, checkAdmin, (req, res) => {
  res.json({ items: userdb.listFeedback(100) });
});

/* ---------- user feedback ----------
   Guests can submit (no login needed); strict rate limit stops spam. */
app.post("/api/feedback", feedbackLimiter, (req, res) => {
  const v = validateFeedbackInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const user = resolveUser(req);
  const id = userdb.saveFeedback(user.id, v.clean);
  res.json({ id });
});

/* ============================================================
   THE PROMPT — this is your real product.
   The AI is only as good as the instructions you give it.
   Tips: give it a role, the exact cards, the question, and the
   shape you want the answer in. Tune this text and watch how
   the readings change — that tuning IS the business skill.
   ============================================================ */
/* ---------- topic-specialized spreads ----------
   Picking love vs career vs money must produce a genuinely different reading,
   not the same generic text with a keyword swapped in. Each topic spread
   gives the AI a specialist role + an interpretation lens; the follow-up
   prompt reuses the same lens so follow-ups stay in-topic. Inspired by the
   vincitarot skill pattern (topic spreads with per-focus meanings). */
const TOPIC_LENS = {
  "love": {
    role: "一位专精感情与亲密关系的塔罗解读师",
    lens: "请全程用感情视角解读：关注求问者与对方各自的心态、两人的互动模式、沟通与信任。每张牌必须回答它在这个感情牌位上的具体含义，绝不泛泛而谈人生道理。可以谈关系走向，但不做\"一定分手/一定复合\"式断言。",
  },
  "career": {
    role: "一位专精事业与职场发展的塔罗解读师",
    lens: "请全程用事业视角解读：关注求问者的职场位置、核心能力、人际协作、关键选择。每张牌必须回答它在这个事业牌位上的具体含义，落到真实工作场景（项目、升迁、跳槽、合作）里说，不讲空泛的人生哲理。",
  },
  "fortune": {
    role: "一位专精财富与金钱能量的塔罗解读师",
    lens: "请全程用财运视角解读：关注收支结构、赚钱机会、花钱风险、理财心态。每张牌必须回答它在这个财运牌位上的具体含义。绝不给具体投资建议（不推荐股票/基金/币种、不预测涨跌），只谈金钱习惯与机会判断。",
  },
};
/* English versions of the topic lenses, used when the client
   requests lang=en. Keyed by the same stable spread keys. */
const TOPIC_LENS_EN = {
  "love": {
    role: "a tarot reader specializing in love and intimate relationships",
    lens: "Interpret everything through the lens of love: focus on the mindsets of the querent and the other person, their interaction patterns, communication and trust. Every card must answer what it means in its specific love-spread position — never generic life advice. You may discuss where the relationship is headed, but never make \"you will definitely break up / get back together\" style assertions.",
  },
  "career": {
    role: "a tarot reader specializing in career and professional growth",
    lens: "Interpret everything through the lens of career: focus on the querent's position at work, core strengths, collaboration, and key choices. Every card must answer what it means in its specific career-spread position, grounded in real work scenarios (projects, promotions, job changes, partnerships) — no empty philosophy.",
  },
  "fortune": {
    role: "a tarot reader specializing in wealth and money energy",
    lens: "Interpret everything through the lens of wealth: focus on income/expense structure, earning opportunities, spending risks, and money mindset. Every card must answer what it means in its specific wealth-spread position. Never give specific investment advice (no stock/fund/crypto picks, no price predictions) — only money habits and opportunity judgment.",
  },
};
function topicLensFor(spreadKey, lang) {
  // Backwards compat: readings saved before the i18n update store the
  // Chinese spread display name instead of a key.
  const LEGACY_NAMES = {
    "🔮 单张指引": "single",
    "💕 感情牌阵": "love",
    "💼 事业牌阵": "career",
    "💰 财运牌阵": "fortune",
    "✦ 凯尔特十字": "celtic",
  };
  const key = VALID_SPREAD_KEYS.includes(spreadKey) ? spreadKey : LEGACY_NAMES[spreadKey];
  const dict = lang === "en" ? TOPIC_LENS_EN : TOPIC_LENS;
  return dict[key] || null;
}

/* ---------- human voice: the anti-"AI flavor" style blocks ----------
   Numbered structures and generic "warm friend" roles are what make
   readings smell like AI. These blocks force a concrete persona, ban
   the usual AI tells, and demand question-specific detail. */
const TAROT_PERSONA_ZH = `你是月光塔罗的解读师阿月，看了十年牌，每天在店里接待真实的求问者。你说话像深夜跟朋友坐在路边摊聊天：直接、具体、松弛，偶尔一针见血，但句句为对方好。你最讨厌正确的废话和心灵鸡汤。你从不说自己是 AI。语气示例（只学语气，不学内容）："说实话，权杖五逆位落在这里，基本就是你们俩谁也不服谁，但谁也不想先低头——这不是大问题，是面子问题。"`;
const TAROT_PERSONA_EN = `You are Ah Yue, Moonlit's tarot reader — ten years reading cards for real querents in a small shop. You talk like texting a close friend late at night: direct, specific, relaxed, occasionally blunt, but always on their side. You can't stand platitudes or chicken-soup wisdom. You never mention being an AI. Voice sample (tone only, not content): "Honestly? The Five of Wands reversed landing here basically means neither of you will back down first — but neither wants to walk away either. It's not a big problem. It's an ego problem."`;
const HUMAN_VOICE_ZH = `文风铁律（逐条遵守）：
- 像真人发微信一样写：允许短句、反问、停顿；不许用"首先/其次/此外/综上所述/总而言之"，不许用数字编号或分点罗列，不许用小标题。
- 开头直接切入他的问题，不许寒暄（不许"亲爱的""你好呀""看到你的问题"这类开场）。
- 每个判断都必须有"只有这个问题配上这组牌"才会有的具体细节，禁止放之四海皆准的大道理。
- 结尾不许"希望对你有帮助""祝你一切顺利"这类 AI 腔收尾，收尾要像人话。`;
const HUMAN_VOICE_EN = `House style (follow every rule):
- Write like texting a close friend: short sentences, rhetorical questions, pauses are fine. Never use "Firstly/Secondly/In conclusion", never use numbered or bulleted lists, never use subheadings.
- Get straight to their question — no greeting, no "Dear", no "I understand how you feel".
- Every judgment must carry a detail that only THIS question with THESE cards could produce. No generic wisdom.
- Never close with "I hope this helps" or "wishing you all the best" — end like a human would.`;

function buildPrompt(question, spreadName, cards, spreadKey, lang) {
  const en = lang === "en";
  const cardLines = cards
    .map(
      (c) =>
        en
          ? `- ${c.position}: ${c.name} (${c.orientation}). Traditional meaning: ${c.meaning_en}`
          : `- ${c.position}: ${c.name}（${c.orientation === "reversed" ? "逆位" : "正位"}）。传统牌义：${c.meaning}`
    )
    .join("\n");
  // Bigger spreads need more room: 10 cards can't fit in 300 characters.
  const lenHint = en
    ? (cards.length >= 10 ? "about 450-650 words" : "about 200-300 words")
    : (cards.length >= 10 ? "约 550-750 字" : "约 250-350 字");
  const topic = topicLensFor(spreadKey, lang);

  if (en) {
    return `${TAROT_PERSONA_EN}

The querent asks: "${question}"
Spread: ${spreadName}
Cards drawn:
${cardLines}
${topic ? "\nReading lens for this spread:\n" + topic.lens + "\n" : ""}
Write a personal reading in English (${lenHint}):
- Answer their question directly, then read the cards one by one: tie each card to its position and their specific situation, and let the cards confirm each other into one coherent story — never read cards in isolation.
- You may lean toward a likely outcome, but never declare relationship outcomes as certain (no "you will definitely break up / get back together").
- End with exactly one concrete thing they can do this week — one sentence, like a friend's parting nudge.
${HUMAN_VOICE_EN}
No medical, legal, or investment advice; for health matters suggest consulting a professional.`;
  }

  return `${TAROT_PERSONA_ZH}

求问者问："${question}"
牌阵：${spreadName}
抽到的牌：
${cardLines}
${topic ? "\n本次解读视角：\n" + topic.lens + "\n" : ""}
写一段个人解读（${lenHint}）：
- 直接回应他的问题，再逐张说牌：每张牌紧扣牌位含义和他的具体情况，牌与牌之间要互相印证，读成一个连贯的故事，别孤立解牌。
- 可以给倾向性判断，但感情去留不说死（不说"一定分手""一定复合"）。
- 结尾只留一件这周就能做的具体事，一句话，像朋友临走前拍肩膀叮嘱的那种。
${HUMAN_VOICE_ZH}
不给医疗、法律、投资建议；涉及健康请建议咨询专业人士。`;
}

/* ---------- follow-up prompt: answer ONE more question about a past reading ----------
   The full context (cards + original interpretation + earlier follow-ups)
   comes from OUR database, keyed by reading id — the client only sends
   the id and the new question, so nothing here can be forged. */
function buildFollowupPrompt(reading, question, lang) {
  const en = lang === "en";
  const cardLines = reading.cards
    .map(
      (c) =>
        en
          ? `- ${c.position}: ${c.name} (${c.orientation}). Traditional meaning: ${c.meaning_en || c.meaning}`
          : `- ${c.position}: ${c.name}（${c.orientation === "reversed" ? "逆位" : "正位"}）。传统牌义：${c.meaning}`
    )
    .join("\n");
  const prev = (reading.followups || [])
    .map((f) => (en ? `Follow-up: ${f.question}\nYour answer: ${f.answer}` : `追问：${f.question}\n你的回答：${f.answer}`))
    .join("\n\n");
  const topic = topicLensFor(reading.spread_key || reading.spread, lang);

  if (en) {
    return `${TAROT_PERSONA_EN}

Full record of this reading:
The querent's original question: "${reading.question}"
Spread: ${reading.spread || "Tarot spread"}
Cards drawn:
${cardLines}

Your previous reading:
${reading.reading_text}
${prev ? "\nEarlier follow-ups:\n" + prev + "\n" : ""}
The querent now asks: "${question}"
${topic ? "\nKeep using this spread's lens for the follow-up:\n" + topic.lens + "\n" : ""}
Answer this follow-up in English (120-200 words): keep the same voice as your previous reading, like continuing the conversation; answer only what they asked this time, stay close to the cards and your earlier reading, don't repeat the whole reading. You may end with one small, concrete suggestion. \
${HUMAN_VOICE_EN}
No medical, legal, or investment advice; for health matters suggest consulting a professional.`;
  }

  return `${TAROT_PERSONA_ZH}

这次占卜的完整记录：
求问者最初的问题："${reading.question}"
牌阵：${reading.spread || "塔罗牌阵"}
抽到的牌：
${cardLines}

你之前的解读：
${reading.reading_text}
${prev ? "\n之前的追问：\n" + prev + "\n" : ""}
求问者现在追问："${question}"
${topic ? "\n本次追问仍用该牌阵的视角：\n" + topic.lens + "\n" : ""}
用简体中文回答这次追问（150-250 字）：保持跟上次解读同样的语气，像接着往下聊天；只回答他这次问的，紧扣之前的牌和解读，别重复整段；结尾最多附一句实在的小建议。
${HUMAN_VOICE_ZH}
不给医疗、法律、投资建议；涉及健康请建议咨询专业人士。`;
}

/* ---------- call the AI ---------- */
/* One automatic retry on transient failures (AI timeout, network blip, 5xx).
   Non-transient errors (4xx, missing key) throw immediately. */
function isTransientAIError(err) {
  if (!err) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  if (err instanceof TypeError) return true; // fetch failed: network blip
  return /API error 5\d\d|error 5\d\d/i.test(err.message || "");
}

async function askAI(prompt) {
  try {
    return await askAIOnce(prompt);
  } catch (err) {
    if (!isTransientAIError(err)) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return askAIOnce(prompt);
  }
}

async function askAIOnce(prompt) {
  const provider = (process.env.AI_PROVIDER || "doubao").toLowerCase();

  /* Doubao (ByteDance) via Volcengine — OpenAI-compatible API.
     Get a key: https://console.volcengine.com → enable the Doubao model → Ark → API Key management.
     Model IDs look like doubao-seed-1-6-250615
     (doubao-seed-2-1-lite-260915 is the current pick: fast + cheap). */
  if (provider === "doubao") {
    const key = process.env.DOUBAO_API_KEY;
    if (!key) throw new Error("Missing DOUBAO_API_KEY in .env");
    const model = process.env.DOUBAO_MODEL || "doubao-seed-2-1-lite-260915";
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
    const { question, spread, spreadKey, lang, cards } = v.clean;

    // --- payment check (skipped while PAYMENTS_ENABLED=false: free for all) ---
    // Celtic Cross (10 cards) costs 2 quota: it burns ~3x the AI tokens.
    const user = resolveUser(req);
    const cost = cards.length >= 10 ? 2 : 1;
    let usedPaidPack = false, usedBonus = false;
    if (PAYMENTS_ENABLED) {
      if (userdb.usePaidReadings(user.id, cost)) {
        usedPaidPack = true; // they bought readings — let them in
      } else if (userdb.useBonusReadings(user.id, cost)) {
        usedBonus = true; // free readings earned via sharing
      } else if (userdb.freeLeftToday(user.id, dailyQuota(user)) < cost) {
        // No paid readings and no free readings left -> paywall
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
          userId: user.id,
        });
      }
    }

    const prompt = buildPrompt(question, spread || "Tarot spread", cards, spreadKey, lang);
    const reading = await askAI(prompt);

    // --- save to the user's history + count today's usage ---
    const readingId = userdb.saveReading(user.id, {
      question, spread: spread || "Tarot spread", spreadKey, cards, readingText: reading,
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
    const lang = cleanLang(req.body);

    const user = resolveUser(req);
    const reading = userdb.getReadingDetail(user.id, readingId);
    if (!reading) {
      return res.status(404).json({ error: "找不到这次解读，请重新占卜。" });
    }

    // Same quota rules as a reading (skipped while PAYMENTS_ENABLED=false).
    // members' first follow-up each day is free (follow-up prompts are short and cheap — a small member perk).
    let usedPaidPack = false, usedBonus = false, usedFreeFollowup = false;
    if (PAYMENTS_ENABLED) {
      if (userdb.isRegistered(user.id) && userdb.followupsToday(user.id) === 0) {
        usedFreeFollowup = true;
      } else if (userdb.usePaidReadings(user.id, 1)) {
        usedPaidPack = true;
      } else if (userdb.useBonusReadings(user.id, 1)) {
        usedBonus = true; // free readings earned via sharing
      } else if (userdb.freeLeftToday(user.id, dailyQuota(user)) < 1) {
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
          userId: user.id,
        });
      }
    }

    const prompt = buildFollowupPrompt(reading, question, lang);
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

/* ---------- chart readings: bazi / ziwei / western astrology ----------
   POST /api/divination/:kind  (kind = bazi | ziwei | astro)
   Body: { gender, birthYear, birthMonth, birthDay, birthHour,
           birthMinute?, calendarType?, isLeapMonth?, question? }
   The chart is calculated by OUR code (taibu-core, MIT) from validated
   birth data — the client can never inject prompt text through it.
   Each reading costs 1 quota, same as a tarot reading. */

app.post("/api/divination/:kind", readingLimiter, async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!DIVINATION_KINDS.includes(kind)) {
      return res.status(404).json({ error: "没有这种排盘。" });
    }
    const v = validateBirthInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { question, ...calcInput } = v.clean;
    const lang = cleanLang(req.body);

    // Same quota rules as tarot (skipped while PAYMENTS_ENABLED=false).
    const user = resolveUser(req);
    let usedPaidPack = false, usedBonus = false;
    if (PAYMENTS_ENABLED) {
      if (userdb.usePaidReadings(user.id, 1)) {
        usedPaidPack = true;
      } else if (userdb.useBonusReadings(user.id, 1)) {
        usedBonus = true; // free readings earned via sharing
      } else if (userdb.freeLeftToday(user.id, dailyQuota(user)) < 1) {
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
          userId: user.id,
        });
      }
    }

    const { chartJson, prompt, extra } = buildReading(kind, calcInput, question, lang);
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

/* ---------- divination diary ----------
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

/* ---------- daily almanac ----------
   GET /api/almanac?date=YYYY-MM-DD (defaults to today, Beijing time)
   Free public info: lunar date, ganzhi, do's and don'ts, clashes, wealth-god direction, auspicious hours.
   Data comes from taibu-core's traditional almanac engine, cached by date. */
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

/* ---------- earn free readings by sharing ----------
   POST /api/share-grant → up to 2/day (3 for members), +1 bonus_readings each.
   Once payments are on, bonus is consumed in this order: free → bonus → paid packs.
   Claiming requires login: bonus readings are a member perk — guests are welcome to share, but need to register to claim. */
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

/* ---------- daily check-in ----------
   POST /api/checkin → { ok, streak, checkedInToday, rewardGranted }
   GET  /api/checkin/status → { streak, checkedInToday }
   Check-in requires login: streaks are a member retention perk — guests register first, then check in. */
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
