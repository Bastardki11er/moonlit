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
  // shuffle ritual: the deck jitters like it's being shuffled, then breathes to invite a draw
  const deckEl = $("deck");
  deckEl.classList.remove("inviting");
  deckEl.classList.add("shuffling");
  $("draw-hint").textContent = "正在洗牌… 🔮";
  $("draw-progress").textContent = "";
  seedMotes();
  setTimeout(() => {
    deckEl.classList.remove("shuffling");
    deckEl.classList.add("inviting");
    $("draw-hint").textContent = "点击牌堆抽牌，点击每张牌翻面。";
  }, 1000);
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
  renderDrawnCard(card, reversed, position, state.drawn.length - 1);
  $("draw-progress").textContent = "（" + state.drawn.length + "/" + spread.count + "）";

  if (state.drawn.length === spread.count) {
    $("deck").classList.remove("inviting");
    setTimeout(showReadingStep, 900);
  }
});

// suit glyphs for the card faces
const SUIT_GLYPH = { major: "✦", Wands: "🔥", Cups: "🌊", Swords: "⚔️", Pentacles: "🪙" };

function renderDrawnCard(card, reversed, position, index) {
  const slot = el("div", "draw-slot");
  const wrap = el("div", "tarot-card");
  const inner = el("div", "inner");
  const back = el("div", "face back", "🌙");
  const front = el("div", "face front" + (reversed ? " reversed-card" : ""));
  front.appendChild(el("div", "glyph", SUIT_GLYPH[card.arcana === "major" ? "major" : card.suit] || "✦"));
  front.appendChild(el("div", "cname", card.name));
  front.appendChild(el("div", "arcana", card.arcana === "major" ? "大阿卡纳" : "小阿卡纳 · " + (SUIT_ZH[card.suit] || card.suit)));
  front.appendChild(el("div", "orientation", reversed ? "逆位" : "正位 · " + position));
  inner.appendChild(back);
  inner.appendChild(front);
  wrap.appendChild(inner);
  wrap.title = position + " — 点击翻牌";
  slot.appendChild(wrap);
  slot.appendChild(el("div", "pos-tag", position));
  $("drawn").appendChild(slot);

  // deal flight: the card visibly flies out of the deck into its slot
  const deckR = $("deck").getBoundingClientRect();
  const slotR = slot.getBoundingClientRect();
  const dx = deckR.left + deckR.width / 2 - (slotR.left + slotR.width / 2);
  const dy = deckR.top + deckR.height / 2 - (slotR.top + slotR.height / 2);
  slot.style.transition = "none";
  slot.style.transform = "translate(" + dx + "px," + dy + "px) scale(.6) rotate(-6deg)";
  slot.style.opacity = "0";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    slot.style.transition = "transform .55s cubic-bezier(.2,.8,.25,1), opacity .4s ease";
    slot.style.transform = "";
    slot.style.opacity = "1";
    slot.addEventListener("transitionend", function h(e) {
      if (e.propertyName !== "transform") return;
      slot.removeEventListener("transitionend", h);
      slot.style.transition = ""; slot.style.transform = ""; slot.style.opacity = "";
    });
  }));

  const reveal = () => {
    if (wrap.classList.contains("revealed")) return;
    wrap.classList.add("revealed");
    sparkBurst(wrap.getBoundingClientRect());
  };
  wrap.addEventListener("click", reveal);
  // auto-flip with a stagger so it feels alive
  setTimeout(reveal, 450 + index * 220);
}

// golden sparks that burst outward when a card is revealed
function sparkBurst(rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 16; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    document.body.appendChild(s);
    const ang = Math.random() * Math.PI * 2;
    const dist = 46 + Math.random() * 80;
    const ddx = Math.cos(ang) * dist, ddy = Math.sin(ang) * dist;
    s.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: "translate(calc(-50% + " + ddx + "px), calc(-50% + " + ddy + "px)) scale(.1)", opacity: 0 },
      ],
      { duration: 550 + Math.random() * 450, easing: "cubic-bezier(.2,.7,.3,1)" }
    ).onfinish = () => s.remove();
  }
}

// floating golden dust in the card table
function seedMotes() {
  const fx = $("draw-fx");
  if (!fx) return;
  fx.innerHTML = "";
  for (let i = 0; i < 28; i++) {
    const m = el("span", "mote");
    const size = 2 + Math.random() * 4;
    m.style.width = m.style.height = size.toFixed(0) + "px";
    m.style.left = (Math.random() * 100).toFixed(1) + "%";
    m.style.top = (15 + Math.random() * 80).toFixed(1) + "%";
    m.style.animationDuration = (6 + Math.random() * 9).toFixed(1) + "s";
    m.style.animationDelay = (-Math.random() * 12).toFixed(1) + "s";
    fx.appendChild(m);
  }
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
