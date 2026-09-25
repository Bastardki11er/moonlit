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

/* ---------- Paid reading packs: ip -> number of paid readings left.
   (A real business would use a database; this Map is for learning.
   It resets when the server restarts.) */
const paidPacks = new Map();

/* ---------- Orders: orderId -> { ip, created }; paid order ids ---------- */
const pendingOrders = new Map();
const paidOrders = new Set();
const PRICE_CNY = parseFloat(process.env.PRICE_CNY || "9.9");
const READINGS_PER_PACK = parseInt(process.env.READINGS_PER_PACK || "10", 10);
/* Charging is OFF by default: everyone gets unlimited free readings.
   Set PAYMENTS_ENABLED=true in .env when you're ready to charge. */
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "true";

// Load secrets from the .env file (never commit .env to git!)
require("dotenv").config();

const app = express();

/* XorPay payment notification: XorPay calls this URL after the visitor pays.
   Protection: we only credit orders that WE created (pendingOrders) —
   a stranger cannot forge a payment for an order id they don't know. */
app.post("/api/xorpay-notify", (req, res) => {
  const p = req.body || {};
  console.log("XorPay notify received:", JSON.stringify(p));
  const orderId = p.order_id || p.orderId || p.out_trade_no;
  if (orderId && pendingOrders.has(orderId)) {
    const { ip } = pendingOrders.get(orderId);
    paidPacks.set(ip, (paidPacks.get(ip) || 0) + READINGS_PER_PACK);
    pendingOrders.delete(orderId);
    paidOrders.add(orderId);
    console.log(`Order ${orderId} paid — credited ${READINGS_PER_PACK} readings`);
  }
  res.send("ok"); // XorPay expects "ok", otherwise it retries
});

/* The frontend polls this to learn when the QR payment succeeded. */
app.get("/api/order-status", (req, res) => {
  const orderId = req.query.orderId;
  res.json({ paid: !!orderId && paidOrders.has(orderId) });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // XorPay notify may be form-encoded

// Serve the frontend files
app.use(express.static(path.join(__dirname, "..", "frontend")));

/* ---------- simple free-reading limit (your first paywall) ----------
   Each visitor (by IP address) gets a few free readings per day.
   After that, the API says "payment required" — later you connect
   this to Stripe so paying unlocks more readings. */
const FREE_PER_DAY = parseInt(process.env.FREE_READINGS_PER_DAY || "3", 10);
const usage = new Map(); // ip -> { date: "2026-09-24", count: 2 }

function freeReadingsLeft(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const rec = usage.get(ip);
  if (!rec || rec.date !== today) {
    usage.set(ip, { date: today, count: 0 });
    return FREE_PER_DAY;
  }
  return FREE_PER_DAY - rec.count;
}
function countReading(ip) {
  const today = new Date().toISOString().slice(0, 10);
  let rec = usage.get(ip);
  if (!rec || rec.date !== today) {
    rec = { date: today, count: 0 };
    usage.set(ip, rec);
  }
  rec.count += 1;
}

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

  return `你是"月光塔罗"（Moonlit），一位有 20 年经验、温暖而深刻的塔罗占卜师。\
你说话温柔、直接、像朋友一样 — 从不说空话套话。

求问者问："${question}"
牌阵：${spreadName}
抽到的牌：
${cardLines}

请用简体中文写一段个人化的塔罗解读（约 250-350 字）：
1. 开头用一句话共情他的问题。
2. 结合牌位，逐张解读每张牌，并紧扣他的具体问题。
3. 把牌编织成一个连贯的故事 — 展现它们之间的关联。
4. 结尾给出清晰、温暖、可执行的建议：这周可以做的一件事。
5. 绝不透露你是 AI。不给医疗、法律、投资建议；涉及健康请建议咨询专业人士。`;
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
app.post("/api/reading", async (req, res) => {
  try {
    const { question, spread, cards } = req.body || {};
    if (!question || !Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: "Missing question or cards." });
    }

    // --- payment check (skipped while PAYMENTS_ENABLED=false: free for all) ---
    const ip = req.ip;
    let usedPaidPack = false;
    if (PAYMENTS_ENABLED) {
      if ((paidPacks.get(ip) || 0) > 0) {
        usedPaidPack = true; // they bought readings — let them in
      } else if (freeReadingsLeft(ip) <= 0) {
        // No paid readings and no free readings left -> paywall
        return res.status(402).json({
          error: `Free readings used up for today. Unlock ${READINGS_PER_PACK} more for ¥${PRICE_CNY} ✨`,
          paymentRequired: true,
        });
      }
    }

    const prompt = buildPrompt(question, spread || "Tarot spread", cards);
    const reading = await askAI(prompt);
    if (usedPaidPack) paidPacks.set(ip, paidPacks.get(ip) - 1);
    else countReading(ip);

    res.json({ reading });
  } catch (err) {
    console.error("Reading failed:", err.message);
    res.status(500).json({ error: "The AI could not answer right now. Try again." });
  }
});

/* ---------- XorPay checkout: visitor pays ¥9.9 once ----------
   Body: { method: "wechat" | "alipay" }
   Creates an order at XorPay and returns a QR code for the visitor to scan
   with WeChat / Alipay. The frontend polls /api/order-status until paid,
   then XorPay's notify credits the buyer automatically. */
app.post("/api/checkout", async (req, res) => {
  if (!xorpayReady()) {
    return res.status(500).json({ error: "Payments are not configured yet." });
  }
  const payType = req.body && req.body.method === "alipay" ? "alipay" : "wechat";
  const orderId = "moonlit-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
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
    pendingOrders.set(orderId, { ip: req.ip, created: Date.now() });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌙 Moonlit running at http://localhost:${PORT}`);
  console.log(`   AI provider: ${process.env.AI_PROVIDER || "doubao"}`);
  console.log(`   Free readings/day per visitor: ${FREE_PER_DAY}`);
  console.log(`   XorPay: ${xorpayReady() ? "connected" : "not configured"}`);
  console.log(`   Payments: ${PAYMENTS_ENABLED ? `ON — ¥${PRICE_CNY} for ${READINGS_PER_PACK} readings` : "OFF (free for everyone)"}`);
});
