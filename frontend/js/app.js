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
// NOTE: cards.js stores suit in lowercase ("wands"), so keys here are lowercase too.
const SUIT_ZH = { wands: "权杖", cups: "圣杯", swords: "宝剑", pentacles: "星币" };

let state = { question: "", spreadKey: null, deck: [], drawn: [] };

// ---------- user identity ----------
// Every visitor gets a permanent anonymous id (stored in localStorage).
// The backend creates a user row + saves all their readings under it.
// Anonymous by default (id in localStorage); optional email login
// (token in localStorage) syncs everything across devices.
let moonlitUserId = null;
let moonlitToken = null;
let moonlitEmail = null;
try { moonlitToken = localStorage.getItem("moonlit_token") || null; } catch (e) {}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (moonlitToken) h["Authorization"] = "Bearer " + moonlitToken;
  return h;
}

function renderAuthButton() {
  const btn = $("nav-auth");
  if (!btn) return;
  if (moonlitEmail) {
    const short = moonlitEmail.length > 14 ? moonlitEmail.slice(0, 12) + "…" : moonlitEmail;
    btn.textContent = "👤 " + short;
    btn.title = moonlitEmail + "（已登录，点击管理）";
  } else {
    btn.textContent = "👤 登录 / 注册";
    btn.title = "";
  }
}

function setLoggedIn(token, email, userId) {
  moonlitToken = token;
  moonlitEmail = email;
  try { localStorage.setItem("moonlit_token", token); } catch (e) {}
  if (userId) {
    moonlitUserId = userId;
    try { localStorage.setItem("moonlit_uid", userId); } catch (e) {}
  }
  renderAuthButton();
  updateHistoryBadge();
}

function setLoggedOut() {
  moonlitToken = null;
  moonlitEmail = null;
  try { localStorage.removeItem("moonlit_token"); } catch (e) {}
  renderAuthButton();
}

async function initUser() {
  try {
    // Returning visit with a login token? Restore the session first.
    if (moonlitToken) {
      const me = await fetch("/api/auth/me", { headers: authHeaders() });
      if (me.ok) {
        const data = await me.json();
        setLoggedIn(moonlitToken, data.email, data.userId);
        return;
      }
      setLoggedOut(); // token expired or revoked
    }
    const stored = localStorage.getItem("moonlit_uid");
    const res = await fetch("/api/user/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: stored }),
    });
    const data = await res.json();
    moonlitUserId = data.userId;
    localStorage.setItem("moonlit_uid", moonlitUserId);
    renderAuthButton();
    updateHistoryBadge();
  } catch (e) { /* offline — readings still work, just not saved */ }
}
initUser();

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

// card faces now show the real painted artwork (img/cards/<id>.webp)

function renderDrawnCard(card, reversed, position, index) {
  const slot = el("div", "draw-slot");
  const wrap = el("div", "tarot-card");
  const inner = el("div", "inner");
  const back = el("div", "face back", "🌙");
  const front = el("div", "face front" + (reversed ? " reversed-card" : ""));
  const art = document.createElement("img");
  art.className = "card-art";
  art.src = "img/cards/" + card.id + ".webp";
  art.alt = zhCardName(card);
  art.loading = "lazy";
  front.appendChild(art);
  const cap = el("div", "card-caption");
  cap.appendChild(el("div", "cname", zhCardName(card)));
  cap.appendChild(el("div", "orientation", reversed ? "逆位" : "正位"));
  front.appendChild(cap);
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
      d.position + ": " + zhCardName(d.card) + (d.reversed ? " ⟲" : "")));
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
    const result = DEMO_MODE ? { text: makeSampleReading() } : await fetchRealReading();
    box.classList.remove("loading");
    box.textContent = result.text;
    lastReadingText = result.text;
    $("share-reading").hidden = false;
    const note = $("reading-note");
    note.hidden = false;
    note.textContent = DEMO_MODE
      ? "示例解读（演示模式）。在后端接入 AI API Key 后，即可获得真正的个人化解读。"
      : "AI 根据你的问题和牌面生成的解读。" +
        (typeof result.freeLeft === "number" && result.freeLeft <= 1
          ? "（今天还剩 " + result.freeLeft + " 次免费解读）" : "");
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
    headers: authHeaders(),
    body: JSON.stringify({
      userId: moonlitUserId,
      question: state.question,
      spread: SPREADS[state.spreadKey].name,
      cards: state.drawn.map((d) => ({
        position: d.position,
        id: d.card.id,
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
  // backend may have created the user for us — keep the id in sync
  if (data.userId && data.userId !== moonlitUserId) {
    moonlitUserId = data.userId;
    localStorage.setItem("moonlit_uid", moonlitUserId);
  }
  updateHistoryBadge();
  return { text: data.reading, freeLeft: data.freeLeft };
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
      d.position + " — " + zhCardName(d.card) +
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
  $("share-reading").hidden = true;
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
      headers: authHeaders(),
      body: JSON.stringify({ method, userId: moonlitUserId }),
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

/* ---------- 牌鉴 gallery: browse all 78 cards ---------- */
const GALLERY_GROUPS = [
  { key: "major", title: "大阿卡纳 · 22" },
  { key: "wands", title: "权杖 · 14" },
  { key: "cups", title: "圣杯 · 14" },
  { key: "swords", title: "宝剑 · 14" },
  { key: "pentacles", title: "星币 · 14" },
];

function buildGallery() {
  const grid = $("gallery-grid");
  if (!grid) return;
  GALLERY_GROUPS.forEach((g) => {
    grid.appendChild(el("h3", "gallery-group", g.title));
    const row = el("div", "gallery-row");
    TAROT_CARDS
      .filter((c) => (c.arcana === "major" ? "major" : c.suit) === g.key)
      .forEach((c) => {
        const item = el("div", "gallery-item");
        const img = document.createElement("img");
        img.src = "img/cards/" + c.id + ".webp";
        img.alt = zhCardName(c);
        img.loading = "lazy";
        item.appendChild(img);
        item.appendChild(el("div", "gallery-name", zhCardName(c)));
        item.addEventListener("click", () => openCardModal(c));
        row.appendChild(item);
      });
    grid.appendChild(row);
  });
}

function openCardModal(c) {
  const art = $("modal-art");
  art.src = "img/cards/" + c.id + ".webp";
  art.alt = zhCardName(c);
  $("modal-name").textContent = zhCardName(c);
  $("modal-arcana").textContent =
    c.arcana === "major" ? "大阿卡纳" : "小阿卡纳 · " + (SUIT_ZH[c.suit] || c.suit);
  $("modal-up").textContent = "正位 · " + c.upright;
  $("modal-rev").textContent = "逆位 · " + c.reversed;
  $("modal-detail-link").href = "cards/" + c.id + ".html";
  $("card-modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCardModal() {
  $("card-modal").hidden = true;
  document.body.style.overflow = "";
}

if ($("card-modal")) {
  $("modal-close").addEventListener("click", closeCardModal);
  $("card-modal").addEventListener("click", (e) => {
    if (e.target.id === "card-modal") closeCardModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCardModal();
  });
  buildGallery();
}

/* ---------- 我的记录：reading history ----------
   Every reading is saved server-side under the visitor's user id.
   This panel lists them; clicking one expands the full text. */
async function updateHistoryBadge() {
  const badge = $("history-count");
  if (!badge || !moonlitUserId) return;
  try {
    const res = await fetch("/api/user/readings?userId=" + encodeURIComponent(moonlitUserId),
      { headers: authHeaders() });
    const data = await res.json();
    const n = (data.readings || []).length;
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? "99+" : String(n);
  } catch (e) { /* ignore */ }
}

let historyReturnTo = "step-question";

async function openHistory() {
  // remember where we were, so closing history restores it
  historyReturnTo = !$("step-reading").hidden ? "step-reading"
    : !$("step-draw").hidden ? "step-draw" : "step-question";
  // hide the flow panels, show history
  $("step-question").hidden = true;
  $("step-draw").hidden = true;
  $("step-reading").hidden = true;
  const panel = $("step-history");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth" });

  const list = $("history-list");
  list.innerHTML = "<p class='hint'>加载中…</p>";
  try {
    const res = await fetch("/api/user/readings?userId=" + encodeURIComponent(moonlitUserId || ""),
      { headers: authHeaders() });
    const data = await res.json();
    const items = data.readings || [];
    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = "<p class='hint'>还没有解读记录。问一个问题，抽一次牌，这里就会出现你的历史 ✨</p>";
      return;
    }
    items.forEach((r) => {
      const details = el("details", "history-item");
      const date = new Date(r.created_at).toLocaleString("zh-CN", { hour12: false });
      const summary = el("summary", null,
        "<span class='history-q'>" + escapeHtml(r.question) + "</span>" +
        "<span class='history-meta'>" + escapeHtml(r.spread || "") + " · " + date + "</span>");
      const body = el("div", "history-body");
      body.innerHTML = "<p class='hint'>加载中…</p>";
      details.appendChild(summary);
      details.appendChild(body);
      details.addEventListener("toggle", async () => {
        if (!details.open || body.dataset.loaded) return;
        try {
          const rr = await fetch("/api/user/reading/" + r.id +
            "?userId=" + encodeURIComponent(moonlitUserId || ""),
            { headers: authHeaders() });
          const dd = await rr.json();
          const full = dd.reading;
          const cardNames = full.cards.map((c) =>
            escapeHtml(c.position + " · " + zhCardName(c) + (c.orientation === "reversed" ? "（逆位）" : ""))).join("<br>");
          body.innerHTML =
            "<div class='history-cards'>" + cardNames + "</div>" +
            "<div class='reading'>" + escapeHtml(full.reading_text).replace(/\n/g, "<br>") + "</div>";
          body.dataset.loaded = "1";
        } catch (e) {
          body.innerHTML = "<p class='hint'>加载失败，请重试。</p>";
        }
      });
      list.appendChild(details);
    });
  } catch (e) {
    list.innerHTML = "<p class='hint'>加载失败，请检查网络后重试。</p>";
  }
}

function closeHistory() {
  $("step-history").hidden = true;
  $(historyReturnTo).hidden = false;
  $(historyReturnTo).scrollIntoView({ behavior: "smooth" });
}

$("nav-history").addEventListener("click", openHistory);
$("history-close").addEventListener("click", closeHistory);
$("nav-start").addEventListener("click", () => {
  // fresh start: leave history, reset to the question step
  $("step-history").hidden = true;
  $("step-draw").hidden = true;
  $("step-reading").hidden = true;
  $("step-question").hidden = false;
  historyReturnTo = "step-question";
  $("question").focus();
  $("step-question").scrollIntoView({ behavior: "smooth" });
});

/* ============================================================
   分享图：把一次解读画成 1080x1440 的漂亮图片，可保存/分享
   ============================================================ */
let lastReadingText = "";
let shareCanvas = null;

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderShareCanvas({ title, subtitle, cards, bodyText, footer }) {
  const W = 1080, H = 1440;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 背景：深紫渐变
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0d0b1a");
  g.addColorStop(0.55, "#1c1747");
  g.addColorStop(1, "#2a2358");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 星空
  let seed = 20260924;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 140; i++) {
    const x = rand() * W, y = rand() * H, r = rand() * 1.8 + 0.4;
    ctx.fillStyle = "rgba(255,255,255," + (0.25 + rand() * 0.55).toFixed(2) + ")";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  }

  // 金色边框
  ctx.strokeStyle = "rgba(212,175,55,.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, W - 56, H - 56);

  let y = 130;
  ctx.textAlign = "center";
  ctx.fillStyle = "#d4af37";
  ctx.font = "700 60px Georgia, 'Songti SC', serif";
  ctx.fillText("🌙 " + title, W / 2, y);
  y += 40;

  if (subtitle) {
    ctx.fillStyle = "#b9b3d9";
    ctx.font = "36px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    wrapText(ctx, subtitle, W - 240).slice(0, 3).forEach((l) => {
      y += 52;
      ctx.fillText(l, W / 2, y);
    });
    y += 26;
  }

  // 牌阵
  if (cards && cards.length) {
    const n = cards.length;
    const gap = 28;
    const cw = Math.min(300, (W - 180 - gap * (n - 1)) / n);
    const ch = cw * 1.5;
    const totalW = cw * n + gap * (n - 1);
    let x = (W - totalW) / 2;
    const imgs = await Promise.all(
      cards.map((c) => loadImg("img/cards/" + c.id + ".webp").catch(() => null))
    );
    imgs.forEach((img, i) => {
      if (img) {
        if (cards[i].reversed) {
          ctx.save();
          ctx.translate(x + cw / 2, y + ch / 2);
          ctx.rotate(Math.PI);
          ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch);
          ctx.restore();
        } else {
          ctx.drawImage(img, x, y, cw, ch);
        }
      }
      ctx.strokeStyle = "rgba(212,175,55,.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cw, ch);
      ctx.fillStyle = "#f0d98c";
      ctx.font = "28px Georgia, serif";
      let nm = zhCardName(cards[i]) + (cards[i].reversed ? " ·逆位" : "");
      if (nm.length > 16) nm = nm.slice(0, 15) + "…";
      ctx.fillText(nm, x + cw / 2, y + ch + 44);
      x += cw + gap;
    });
    y += ch + 96;
  }

  // 正文
  ctx.textAlign = "left";
  ctx.fillStyle = "#e8e4f5";
  ctx.font = "37px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const bodyLines = wrapText(ctx, bodyText, W - 200);
  const maxLines = 13;
  bodyLines.slice(0, maxLines).forEach((l) => {
    ctx.fillText(l, 100, y);
    y += 58;
  });
  if (bodyLines.length > maxLines) {
    ctx.fillStyle = "#9a94b8";
    ctx.fillText("……", 100, y);
  }

  // ---- 底部引流区：二维码 + 链接（不透明底，盖住可能溢出的正文） ----
  const qrImg = await loadImg("img/qr-site.png").catch(() => null);
  const zoneY = H - 480;
  ctx.fillStyle = "#151130";
  rr(ctx, 28, zoneY, W - 56, 480 - 28, 20);
  ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, zoneY + 2);
  ctx.lineTo(W - 90, zoneY + 2);
  ctx.stroke();

  ctx.textAlign = "center";
  if (qrImg) {
    const qs = 190, qx = W / 2 - qs / 2, qy = zoneY + 30;
    ctx.fillStyle = "#ffffff";
    rr(ctx, qx - 14, qy - 14, qs + 28, qs + 28, 18);
    ctx.fill();
    ctx.drawImage(qrImg, qx, qy, qs, qs);
    ctx.fillStyle = "#f0d98c";
    ctx.font = "33px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillText("长按识别二维码，来月光塔罗抽一张牌", W / 2, qy + qs + 60);
  } else {
    ctx.fillStyle = "#f0d98c";
    ctx.font = "33px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillText("来月光塔罗抽一张牌", W / 2, zoneY + 130);
  }
  ctx.fillStyle = "#9a94b8";
  ctx.font = "30px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(location.origin, W / 2, zoneY + 336);

  // 落款
  ctx.fillStyle = "#d4af37";
  ctx.font = "34px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(footer || "牌为你开门，路要你自己走 ✨", W / 2, H - 88);

  return canvas;
}

function openShareModal(canvas) {
  shareCanvas = canvas;
  $("share-preview").src = canvas.toDataURL("image/png");
  $("share-native").hidden = !navigator.share;
  $("share-modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeShareModal() {
  $("share-modal").hidden = true;
  document.body.style.overflow = "";
}

$("share-close").addEventListener("click", closeShareModal);
$("share-modal").addEventListener("click", (e) => {
  if (e.target === $("share-modal")) closeShareModal();
});

$("share-download").addEventListener("click", () => {
  shareCanvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "moonlit-tarot.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
});

$("share-copylink").addEventListener("click", async () => {
  const btn = $("share-copylink");
  const link = location.origin;
  const text = "我在月光塔罗抽了牌，来试试 → " + link;
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "✅ 已复制";
    setTimeout(() => (btn.textContent = old), 2000);
  } catch (e) {
    prompt("复制这条链接发到小红书 / 朋友圈：", text);
  }
});

$("share-native").addEventListener("click", async () => {
  try {
    const blob = await new Promise((r) => shareCanvas.toBlob(r, "image/png"));
    const file = new File([blob], "moonlit-tarot.png", { type: "image/png" });
    await navigator.share({ files: [file], title: "月光塔罗",
      text: "我在月光塔罗抽了一张牌，来试试 → " + location.origin });
  } catch (e) {
    /* 用户取消了分享 */
  }
});

$("share-reading").addEventListener("click", async () => {
  const btn = $("share-reading");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "正在画图…";
  try {
    const canvas = await renderShareCanvas({
      title: "月光塔罗",
      subtitle: "「" + state.question + "」",
      cards: state.drawn.map((d) => ({
        id: d.card.id,
        name: d.card.name,
        reversed: d.reversed,
      })),
      bodyText: lastReadingText,
      footer: "🌙 月光塔罗 · AI 中文解读",
    });
    openShareModal(canvas);
  } catch (e) {
    alert("生成失败，请重试。");
  }
  btn.disabled = false;
  btn.textContent = old;
});

/* ============================================================
   每日一牌：同一天所有人看到同一张牌（可分享、可讨论）
   ============================================================ */
let dailyCardData = null;

function renderDailyCard() {
  const d = new Date();
  const key =
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  /* 每人每天随机一张：存 localStorage，当天内稳定，换天/换人都不一样 */
  const storeKey = "moonlit_daily_" + key;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (e) {}
  let card, reversed;
  if (saved && saved.id) {
    card = TAROT_CARDS.find((c) => c.id === saved.id) || TAROT_CARDS[0];
    reversed = !!saved.reversed;
  } else {
    card = TAROT_CARDS[Math.floor(Math.random() * TAROT_CARDS.length)];
    reversed = Math.random() < 0.5;
    try { localStorage.setItem(storeKey, JSON.stringify({ id: card.id, reversed })); } catch (e) {}
  }
  const meaning = reversed ? card.reversed : card.upright;

  $("daily-date").textContent = d.getMonth() + 1 + "月" + d.getDate() + "日";
  const art = $("daily-art");
  art.src = "img/cards/" + card.id + ".webp";
  art.alt = zhCardName(card);
  art.style.transform = reversed ? "rotate(180deg)" : "";
  $("daily-name").textContent = zhCardName(card);
  $("daily-orient").textContent = reversed ? "逆位" : "正位";
  $("daily-meaning").textContent = (reversed ? "逆位 · " : "正位 · ") + meaning;
  $("daily-fortune").textContent = "月光说：" + meaning + "。带着这份提醒，好好过今天吧 ✨";

  dailyCardData = { card, reversed, meaning };
}

$("daily-share").addEventListener("click", async () => {
  if (!dailyCardData) return;
  const btn = $("daily-share");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "正在画图…";
  try {
    const { card, reversed, meaning } = dailyCardData;
    const canvas = await renderShareCanvas({
      title: "每日一牌",
      subtitle: $("daily-date").textContent + " · " + zhCardName(card) + (reversed ? "（逆位）" : "（正位）"),
      cards: [{ id: card.id, name: card.name, reversed }],
      bodyText: (reversed ? "逆位 · " : "正位 · ") + meaning + "\n月光说：带着这份提醒，好好过今天吧。",
      footer: "🌙 月光塔罗 · 明天再来抽一张",
    });
    openShareModal(canvas);
  } catch (e) {
    alert("生成失败，请重试。");
  }
  btn.disabled = false;
  btn.textContent = old;
});

renderDailyCard();

/* ============================================================
   邮箱登录 / 注册
   ============================================================ */
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  $("auth-tab-login").classList.toggle("active", mode === "login");
  $("auth-tab-register").classList.toggle("active", mode === "register");
  $("auth-submit").textContent = mode === "login" ? "登录" : "注册";
  $("auth-password2").hidden = mode === "login";
  $("auth-password").setAttribute("autocomplete",
    mode === "login" ? "current-password" : "new-password");
  hideAuthError();
}

function showAuthError(msg) {
  const e = $("auth-error");
  e.textContent = msg;
  e.hidden = false;
}
function hideAuthError() { $("auth-error").hidden = true; }

function openAuthModal() {
  if (moonlitEmail) {
    $("auth-form-view").hidden = true;
    $("auth-logged-view").hidden = false;
    $("auth-logged-email").textContent = moonlitEmail;
  } else {
    $("auth-form-view").hidden = false;
    $("auth-logged-view").hidden = true;
    setAuthMode(authMode);
  }
  $("auth-modal").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeAuthModal() {
  $("auth-modal").hidden = true;
  document.body.style.overflow = "";
}

$("nav-auth").addEventListener("click", openAuthModal);
$("auth-close").addEventListener("click", closeAuthModal);
$("auth-modal").addEventListener("click", (e) => {
  if (e.target === $("auth-modal")) closeAuthModal();
});
$("auth-tab-login").addEventListener("click", () => setAuthMode("login"));
$("auth-tab-register").addEventListener("click", () => setAuthMode("register"));

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  if (authMode === "register" && password !== $("auth-password2").value) {
    showAuthError("两次输入的密码不一致。");
    return;
  }
  const btn = $("auth-submit");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "请稍候…";
  try {
    const res = await fetch("/api/auth/" + authMode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, userId: moonlitUserId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "出错了，请重试。");
    setLoggedIn(data.token, data.email, data.userId);
    closeAuthModal();
  } catch (err) {
    showAuthError(err.message);
  }
  btn.disabled = false;
  btn.textContent = old;
});

$("auth-logout").addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
  } catch (e) { /* 离线也照样退出 */ }
  setLoggedOut();
  try { localStorage.removeItem("moonlit_uid"); } catch (e) {}
  moonlitUserId = null;
  closeAuthModal();
  initUser(); // 回到匿名身份
});
