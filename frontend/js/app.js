/* ============================================================
   Moonlit — frontend logic
   ------------------------------------------------------------
   DEMO_MODE = true  -> runs fully in the browser with
                        sample readings (no server, no API key).
   DEMO_MODE = false -> calls YOUR backend at /api/reading,
                        which talks to the real AI (Doubao).
   The backend keeps your API key secret — never put the key
   in this file, because anyone can read frontend code.
   ============================================================ */

const DEMO_MODE = false; // false = real AI readings via your backend (production).
                             // Set to true only to preview sample readings without a backend.

const SPREADS = {
  single: { name: "单张牌", count: 1, positions: ["你的答案"] },
  three:  { name: "过去 · 现在 · 未来", count: 3, positions: ["过去", "现在", "未来"] },
  five:   { name: "深度洞察", count: 5,
            positions: ["现状", "挑战", "隐藏的影响", "指引", "结果"] },
};

// suit names in Chinese (card names stay in English — tarot tradition)
const SUIT_ZH = { Wands: "权杖", Cups: "圣杯", Swords: "宝剑", Pentacles: "星币" };

let state = { question: "", spreadKey: null, deck: [], drawn: [] };

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---------- step 1+2: question & spread ----------
document.querySelectorAll(".spread-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".spread-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    startSpread(btn.dataset.spread);
  });
});

function startSpread(spreadKey) {
  const q = $("question").value.trim();
  if (!q) {
    alert("请先写下你的问题 🔮");
    $("question").focus();
    document.querySelectorAll(".spread-btn").forEach((b) => b.classList.remove("selected"));
    return;
  }
  state.question = q;
  state.spreadKey = spreadKey;
  state.deck = shuffle([...TAROT_CARDS]);
  state.drawn = [];

  const spread = SPREADS[spreadKey];
  $("draw-count").textContent = spread.count === 1 ? "1 张牌" : spread.count + " 张牌";
  $("drawn").innerHTML = "";
  updateDeckCount();

  $("step-question").hidden = true;
  $("step-draw").hidden = false;
  $("step-reading").hidden = true;
  $("step-draw").scrollIntoView({ behavior: "smooth" });
}

function updateDeckCount() {
  $("deck-left").textContent = "还剩 " + state.deck.length + " 张";
}

// ---------- step 3: draw & reveal ----------
$("deck").addEventListener("click", () => {
  const spread = SPREADS[state.spreadKey];
  if (state.drawn.length >= spread.count || state.deck.length === 0) return;

  const card = state.deck.pop();
  const reversed = Math.random() < 0.5; // real tarot: cards can land reversed
  const position = spread.positions[state.drawn.length];
  state.drawn.push({ card, reversed, position });
  updateDeckCount();
  renderDrawnCard(card, reversed, position);

  if (state.drawn.length === spread.count) {
    setTimeout(showReadingStep, 600);
  }
});

function renderDrawnCard(card, reversed, position) {
  const wrap = el("div", "tarot-card");
  const inner = el("div", "inner");
  const back = el("div", "face back", "🌙");
  const front = el("div", "face front" + (reversed ? " reversed-card" : ""));
  front.appendChild(el("div", "cname", card.name));
  front.appendChild(el("div", "arcana", card.arcana === "major" ? "大阿卡纳" : "小阿卡纳 · " + (SUIT_ZH[card.suit] || card.suit)));
  front.appendChild(el("div", "orientation", reversed ? "逆位" : "正位 · " + position));
  inner.appendChild(back);
  inner.appendChild(front);
  wrap.appendChild(inner);
  wrap.title = position + " — 点击翻牌";
  wrap.addEventListener("click", () => wrap.classList.add("revealed"));
  $("drawn").appendChild(wrap);
  // auto-flip the newest card after a beat so it feels alive
  setTimeout(() => wrap.classList.add("revealed"), 350);
}

function showReadingStep() {
  $("step-draw").hidden = true;
  const box = $("cards-summary");
  box.innerHTML = "";
  state.drawn.forEach((d) => {
    box.appendChild(el("span", "chip",
      d.position + ": " + d.card.name + (d.reversed ? " ⟲" : "")));
  });
  $("reading").hidden = true;
  $("reading-note").hidden = true;
  $("paywall").hidden = true;
  $("get-reading").disabled = false;
  $("step-reading").hidden = false;
  $("step-reading").scrollIntoView({ behavior: "smooth" });
}

// ---------- step 4: the reading ----------
$("get-reading").addEventListener("click", async () => {
  const btn = $("get-reading");
  btn.disabled = true;
  const box = $("reading");
  box.hidden = false;
  box.classList.add("loading");
  box.textContent = "牌正在诉说… 🔮";

  try {
    const text = DEMO_MODE ? makeSampleReading() : await fetchRealReading();
    box.classList.remove("loading");
    box.textContent = text;
    const note = $("reading-note");
    note.hidden = false;
    note.textContent = DEMO_MODE
      ? "示例解读（演示模式）。在后端接入 AI API Key 后，即可获得真正的个人化解读。"
      : "AI 根据你的问题和牌面生成的解读。";
  } catch (err) {
    box.classList.remove("loading");
    if (err.code === 402) {
      // Paywall: free readings are gone, offer the paid pack
      box.hidden = true;
      $("paywall").hidden = false;
      btn.disabled = false;
      btn.textContent = "✨ 获取 AI 解读";
      return;
    }
    box.textContent = "AI 连接失败，请重试。";
    btn.disabled = false;
  }
});

async function fetchRealReading() {
  const res = await fetch("/api/reading", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: state.question,
      spread: SPREADS[state.spreadKey].name,
      cards: state.drawn.map((d) => ({
        position: d.position,
        name: d.card.name,
        orientation: d.reversed ? "reversed" : "upright",
        meaning: d.reversed ? d.card.reversed : d.card.upright,
      })),
    }),
  });
  if (res.status === 402) {
    const err = new Error("payment required");
    err.code = 402; // backend says: free readings used up -> show paywall
    throw err;
  }
  if (!res.ok) throw new Error("API error " + res.status);
  const data = await res.json();
  return data.reading;
}

/* Sample reading generator for DEMO MODE.
   It weaves the real card meanings into a narrative so you can
   feel the product before wiring up the AI. Clearly labeled. */
function makeSampleReading() {
  const q = state.question;
  const lines = [];
  lines.push("你的问题：「" + q + "」\n");
  lines.push("牌这样说：\n");
  state.drawn.forEach((d) => {
    const meaning = d.reversed ? d.card.reversed : d.card.upright;
    lines.push(
      d.position + " — " + d.card.name +
      (d.reversed ? "（逆位）" : "") +
      "：" + meaning
    );
  });
  lines.push(
    "\n把这些牌放在一起，一个主题浮现出来：" +
    "留意那些在你的处境中反复出现的东西，" +
    "相信你已经感受到的信号，" +
    "这周先踏出一小步。牌为你开门 — 路要你自己走。✨"
  );
  return lines.join("\n");
}

// ---------- restart ----------
$("restart").addEventListener("click", () => {
  state = { question: "", spreadKey: null, deck: [], drawn: [] };
  $("question").value = "";
  document.querySelectorAll(".spread-btn").forEach((b) => b.classList.remove("selected"));
  $("step-reading").hidden = true;
  $("step-draw").hidden = true;
  $("step-question").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// show the demo badge when in demo mode
if (DEMO_MODE) $("demo-badge").hidden = false;

/* ---------- paywall: ¥9.9 once via WeChat Pay / Alipay (XorPay) ----------
   1. Visitor picks WeChat or Alipay → backend creates an order at XorPay.
   2. We show the QR code; visitor scans it with their phone and pays.
   3. We poll /api/order-status every 2.5s; XorPay's notify credits the buyer.
   4. On success, the blocked reading runs automatically. */
let payTimer = null;

async function startPay(method) {
  const box = $("qr-box");
  box.hidden = false;
  $("qr").innerHTML = "<p class='hint'>正在创建订单…</p>";
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderQr(data.qr, data.xorpayload);
    pollOrder(data.orderId);
  } catch (err) {
    $("qr").innerHTML =
      "<p class='hint'>Payments are not set up yet — the site owner needs to add XorPay keys.</p>";
  }
}

function renderQr(qr, raw) {
  const el = $("qr");
  el.innerHTML = "";
  if (qr && qr.type === "image") {
    const img = document.createElement("img");
    img.src = qr.value;
    img.alt = "payment QR code";
    img.style.cssText = "width:220px;height:220px;background:#fff;border-radius:12px";
    el.appendChild(img);
  } else if (qr && qr.type === "data") {
    const a = document.createElement("a");
    a.href = qr.value;
    a.textContent = "点击打开支付";
    a.style.cssText = "color:#d4af37;word-break:break-all";
    el.appendChild(a);
  } else {
    // Couldn't find the QR field — show raw data so the owner can fix parsing
    el.innerHTML =
      "<details><summary class='hint'>Payment data (debug — send this to the site owner)</summary>" +
      "<pre style='text-align:left;font-size:11px;white-space:pre-wrap'>" +
      escapeHtml(JSON.stringify(raw, null, 2)) + "</pre></details>";
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function pollOrder(orderId) {
  clearInterval(payTimer);
  $("pay-status").textContent = "⏳";
  payTimer = setInterval(async () => {
    try {
      const r = await fetch("/api/order-status?orderId=" + encodeURIComponent(orderId));
      const d = await r.json();
      if (d.paid) {
        clearInterval(payTimer);
        $("pay-status").textContent = "✅";
        alert("✨ 支付成功！这是你的解读。");
        $("paywall").hidden = true;
        $("qr-box").hidden = true;
        $("get-reading").click(); // run the blocked reading now
      }
    } catch (e) { /* keep polling */ }
  }, 2500);
}

$("pay-wechat").addEventListener("click", () => startPay("wechat"));
$("pay-alipay").addEventListener("click", () => startPay("alipay"));
