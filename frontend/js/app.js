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
  single: { name: "🔮 单张指引", count: 1, positions: ["你的指引"] },
  love:   { name: "💕 感情牌阵", count: 5,
            positions: ["你的状态", "对方的状态", "关系现状", "阻碍", "未来发展"] },
  career: { name: "💼 事业牌阵", count: 5,
            positions: ["事业现状", "你的优势", "当前挑战", "潜在机遇", "未来趋势"] },
  fortune:{ name: "💰 财运牌阵", count: 5,
            positions: ["财务现状", "收入机会", "支出风险", "理财建议", "未来趋势"] },
  celtic: { name: "✦ 凯尔特十字", count: 10,
            positions: ["1 · 现状", "2 · 挑战", "3 · 目标", "4 · 根基", "5 · 过去",
                        "6 · 未来", "7 · 自我", "8 · 环境", "9 · 希望与恐惧", "10 · 结果"] },
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
    btn.title = t("app.auth.title_logged_in", { email: moonlitEmail });
  } else {
    btn.textContent = t("app.auth.login_register");
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
  window.__moonlitMember = true;
  if (typeof window.__refreshBirthMemory === "function") window.__refreshBirthMemory();
  if (typeof window.__refreshGrowth === "function") window.__refreshGrowth();
  renderAuthButton();
  updateHistoryBadge();
}

function setLoggedOut() {
  moonlitToken = null;
  moonlitEmail = null;
  try { localStorage.removeItem("moonlit_token"); } catch (e) {}
  window.__moonlitMember = false;
  if (typeof window.__refreshBirthMemory === "function") window.__refreshBirthMemory();
  if (typeof window.__refreshGrowth === "function") window.__refreshGrowth();
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
        window.__moonlitMember = true;
        return;
      }
      setLoggedOut(); // token expired or revoked
    }
    const stored = localStorage.getItem("moonlit_uid");
    const pendingRef = (() => { try { return localStorage.getItem("moonlit_ref"); } catch (e) { return null; } })();
    const res = await fetch("/api/user/init", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: stored, ref: pendingRef || undefined }),
    });
    const data = await res.json();
    moonlitUserId = data.userId;
    localStorage.setItem("moonlit_uid", moonlitUserId);
    window.__moonlitMember = !!data.isMember;
    window.__moonlitFreePerDay = data.freePerDay || 3;
    window.__followupFree = !!data.followupFree;
    if (data.referralApplied) {
      window.__referralApplied = true;
      if (typeof window.__onReferralApplied === "function") window.__onReferralApplied(data.referralReward || 1);
    }
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
    alert(t("app.draw.ask_question_first"));
    $("question").focus();
    document.querySelectorAll(".spread-btn").forEach((b) => b.classList.remove("selected"));
    return;
  }
  state.question = q;
  state.spreadKey = spreadKey;
  state.deck = shuffle([...TAROT_CARDS]);
  state.drawn = [];

  const spread = SPREADS[spreadKey];
  $("draw-count").textContent = spread.count === 1 ? t("app.draw.one_card") : t("app.draw.count", { n: spread.count });
  $("drawn").innerHTML = "";
  // Celtic Cross gets the classic cross layout (CSS grid); others use flex rows.
  $("drawn").classList.toggle("celtic", spreadKey === "celtic");
  updateDeckCount();

  $("step-question").hidden = true;
  $("step-draw").hidden = false;
  $("step-reading").hidden = true;
  $("step-draw").scrollIntoView({ behavior: "smooth" });
  // shuffle ritual: the deck jitters like it's being shuffled, then breathes to invite a draw
  const deckEl = $("deck");
  deckEl.classList.remove("inviting");
  deckEl.classList.add("shuffling");
  $("draw-hint").textContent = t("app.draw.shuffling");
  $("draw-progress").textContent = "";
  seedMotes();
  setTimeout(() => {
    deckEl.classList.remove("shuffling");
    deckEl.classList.add("inviting");
    $("draw-hint").textContent = t("app.draw.hint");
  }, 1000);
}

function updateDeckCount() {
  $("deck-left").textContent = t("app.draw.deck_left", { n: state.deck.length });
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
  $("draw-progress").textContent = t("app.draw.progress", { a: state.drawn.length, b: spread.count });

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
  cap.appendChild(el("div", "orientation", t(reversed ? "app.draw.reversed" : "app.draw.upright")));
  front.appendChild(cap);
  inner.appendChild(back);
  inner.appendChild(front);
  wrap.appendChild(inner);
  wrap.title = t("app.draw.flip_title", { position: spreadPosName(state.spreadKey, position) });
  slot.appendChild(wrap);
  slot.appendChild(el("div", "pos-tag", spreadPosName(state.spreadKey, position)));
  // Celtic Cross: each slot gets a grid cell; card 2 lies crossed over card 1.
  if (state.spreadKey === "celtic") {
    slot.classList.add("cc" + (index + 1));
    if (index === 1) wrap.classList.add("cc2wrap");
  }
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
  // 直接展示抽到的牌面缩略图，点击可放大，不用再去牌鉴里找
  state.drawn.forEach((d) => {
    const name = zhCardName(d.card);
    const rev = !!d.reversed;
    const cap = (d.position ? d.position + " · " : "") + name + t(rev ? "app.draw.cap_reversed" : "app.draw.cap_upright");
    const wrap = el("div", "result-card");
    wrap.appendChild(cardThumb(d.card.id, cap, rev));
    const label = el("div", "result-card-name",
      escapeHtml(d.position) + "<br>" + escapeHtml(name) + (rev ? " " + t("app.reading.reversed_tag") : ""));
    wrap.appendChild(label);
    box.appendChild(wrap);
  });
  $("reading").hidden = true;
  $("reading-note").hidden = true;
  $("paywall").hidden = true;
  $("get-reading").disabled = false;
  $("step-reading").hidden = false;
  $("step-reading").scrollIntoView({ behavior: "smooth" });
}

// ---------- step 4: the reading ----------
/* One silent retry on transient failure (network blip / 5xx / timeout).
   402 paywall and other 4xx errors are not retried. */
async function withOneRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 402) throw err; // paywall: don't retry
    if (/API error 4\d\d/.test(err.message || "")) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return fn();
  }
}

$("get-reading").addEventListener("click", async () => {
  const btn = $("get-reading");
  btn.disabled = true;
  const box = $("reading");
  box.hidden = false;
  box.classList.add("loading");
  box.textContent = t("app.reading.loading");

  try {
    const result = DEMO_MODE ? { text: makeSampleReading() } : await withOneRetry(fetchRealReading);
    box.classList.remove("loading");
    box.textContent = result.text;
    lastReadingText = result.text;
    currentReadingId = result.readingId || null;
    $("share-reading").hidden = false;
    $("feedback-reading").hidden = false;
    updateReadingNote(result.freeLeft);
    // follow-up box: fresh thread for this reading
    $("followup-thread").innerHTML = "";
    $("followup-input").value = "";
    $("followup-box").hidden = !(DEMO_MODE || currentReadingId);
    paintFollowupHint();
  } catch (err) {
    box.classList.remove("loading");
    if (err.code === 402) {
      // Paywall: free readings are gone, offer the paid pack
      box.hidden = true;
      $("paywall").hidden = false;
      btn.disabled = false;
      btn.textContent = t("app.reading.get_reading");
      return;
    }
    box.textContent = t("app.reading.error_connection");
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
      spreadKey: state.spreadKey,
      lang: getLang(),
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
  return { text: data.reading, freeLeft: data.freeLeft, readingId: data.readingId };
}

/* Sample reading generator for DEMO MODE.
   It weaves the real card meanings into a narrative so you can
   feel the product before wiring up the AI. Clearly labeled. */
function makeSampleReading() {
  const q = state.question;
  const lines = [];
  lines.push(t("app.reading.sample_question", { q }));
  lines.push(t("app.reading.sample_cards_say"));
  state.drawn.forEach((d) => {
    const meaning = d.reversed ? d.card.reversed : d.card.upright;
    lines.push(t("app.reading.sample_card_line", {
      position: d.position,
      name: zhCardName(d.card),
      rev: d.reversed ? t("app.draw.cap_reversed") : "",
      meaning,
    }));
  });
  lines.push(t("app.reading.sample_closing"));
  return lines.join("\n");
}

function updateReadingNote(freeLeft) {
  const note = $("reading-note");
  note.hidden = false;
  note.textContent = DEMO_MODE
    ? t("app.reading.note_demo")
    : t("app.reading.note_generated") +
      (typeof freeLeft === "number" && freeLeft <= 1
        ? t("app.reading.note_free_left", { n: freeLeft }) : "");
}

// ---------- follow-up questions ----------
function appendFollowup(q, a) {
  const thread = $("followup-thread");
  thread.appendChild(el("div", "fu-q", t("app.followup.you_asked") + escapeHtml(q)));
  thread.appendChild(el("div", "fu-a",
    t("app.followup.moonlit_says") + escapeHtml(a).replace(/\n/g, "<br>")));
  thread.lastChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* 追问提示文案：会员且今天还有首免时显示免费提示 */
function paintFollowupHint() {
  const h = $("followup-hint");
  if (!h) return;
  if (window.__moonlitMember && window.__followupFree) {
    h.textContent = t("app.followup.hint_member_free");
  } else {
    h.textContent = t("app.followup.hint_cost");
  }
}

$("followup-send").addEventListener("click", async () => {
  const input = $("followup-input");
  const q = input.value.trim();
  if (!q) { input.focus(); return; }

  if (DEMO_MODE) {
    appendFollowup(q, t("app.followup.demo_answer"));
    input.value = "";
    return;
  }
  if (!currentReadingId) return;

  const btn = $("followup-send");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = t("app.followup.thinking");
  try {
    const res = await withOneRetry(() => fetch("/api/reading/followup", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        userId: moonlitUserId,
        readingId: currentReadingId,
        question: q,
        lang: getLang(),
      }),
    }));
    if (res.status === 402) {
      $("paywall").hidden = false;
      $("paywall").scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "API error " + res.status);
    }
    const data = await res.json();
    appendFollowup(q, data.answer);
    input.value = "";
    window.__followupFree = false; // 用过首免了，文案切回普通
    paintFollowupHint();
    updateReadingNote(data.freeLeft);
    updateHistoryBadge();
  } catch (err) {
    alert(err.message || t("app.reading.error_connection"));
  }
  btn.disabled = false;
  btn.textContent = old;
});

// Enter 键也可以追问
$("followup-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("followup-send").click();
});

// ---------- restart ----------
$("restart").addEventListener("click", () => {
  state = { question: "", spreadKey: null, deck: [], drawn: [] };
  $("question").value = "";
  document.querySelectorAll(".spread-btn").forEach((b) => b.classList.remove("selected"));
  $("step-reading").hidden = true;
  $("share-reading").hidden = true;
  $("followup-box").hidden = true;
  currentReadingId = null;
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
  $("qr").innerHTML = t("app.pay.creating_order");
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
    a.textContent = t("app.pay.open_payment");
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
        alert(t("app.pay.success"));
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
  { key: "major" },
  { key: "wands" },
  { key: "cups" },
  { key: "swords" },
  { key: "pentacles" },
];

function buildGallery() {
  const grid = $("gallery-grid");
  if (!grid) return;
  GALLERY_GROUPS.forEach((g) => {
    grid.appendChild(el("h3", "gallery-group", t("app.gallery.group_" + g.key)));
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

// i18n: suit display name, resolved at display time so the language toggle works
function suitName(suit) {
  const key = "app.cards.suit_" + suit;
  const v = t(key);
  return (v && v !== key) ? v : (SUIT_ZH[suit] || suit);
}

// i18n: spread position name. The wire/storage format is the Chinese string;
// in English mode we map it back through the spread's position list.
function spreadPosName(spreadKey, zhPos) {
  if (getLang() !== "en" || !zhPos) return zhPos || "";
  const arr = (SPREADS[spreadKey] || {}).positions || [];
  const i = arr.indexOf(zhPos);
  if (i < 0) return zhPos;
  const v = t("app.spread." + spreadKey + ".position_" + i);
  return v || zhPos;
}

// i18n: spread display name for history rows (new rows carry spread_key;
// very old rows only have the Chinese name stored in `spread`).
function spreadDisplayName(r) {
  if (r.spread_key) {
    const v = t("html.spread." + r.spread_key + ".name");
    if (v) return v;
  }
  return r.spread || "";
}

function openCardModal(c) {
  const art = $("modal-art");
  art.src = "img/cards/" + c.id + ".webp";
  art.alt = zhCardName(c);
  art.classList.add("zoomable");
  art.title = t("app.cards.zoom_title");
  art.onclick = () => openLightbox(art.src, zhCardName(c));
  $("modal-name").textContent = zhCardName(c);
  $("modal-arcana").textContent =
    c.arcana === "major" ? t("app.cards.arcana_major") : t("app.cards.arcana_minor", { suit: suitName(c.suit) });
  $("modal-up").textContent = t("app.cards.upright_desc", { text: cardMeaning(c, "upright") });
  $("modal-rev").textContent = t("app.cards.reversed_desc", { text: cardMeaning(c, "reversed") });
  $("modal-detail-link").href = "cards/" + c.id + ".html";
  $("card-modal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCardModal() {
  $("card-modal").hidden = true;
  document.body.style.overflow = "";
}

/* ---------- 图片灯箱：点击任意牌图放大查看 ---------- */
function openLightbox(src, caption, reversed) {
  const lb = $("lightbox");
  if (!lb || !src) return;
  const img = $("lightbox-img");
  img.src = src;
  img.alt = caption || "";
  img.style.transform = reversed ? "rotate(180deg)" : "";
  $("lightbox-cap").textContent = caption || "";
  lb.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  const lb = $("lightbox");
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  // 只有其他弹窗都关了才恢复滚动
  if ($("card-modal").hidden && $("journal-modal").hidden && $("auth-modal").hidden && $("share-modal").hidden && $("feedback-modal").hidden) {
    document.body.style.overflow = "";
  }
}

if ($("lightbox")) {
  $("lightbox").addEventListener("click", closeLightbox);
}

/* 牌面缩略图：共用的小图组件，点击放大 */
function cardThumb(cardId, caption, reversed) {
  const img = document.createElement("img");
  img.src = "img/cards/" + cardId + ".webp";
  img.alt = caption || "";
  img.loading = "lazy";
  img.className = "zoomable" + (reversed ? " reversed" : "");
  img.title = t("app.cards.zoom_title");
  img.addEventListener("click", () => openLightbox(img.src, caption || "", !!reversed));
  return img;
}

if ($("card-modal")) {
  $("modal-close").addEventListener("click", closeCardModal);
  $("card-modal").addEventListener("click", (e) => {
    if (e.target.id === "card-modal") closeCardModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("lightbox").hidden) closeCardModal();
  });
  buildGallery();
}

/* 灯箱的 Esc：注册在牌详情弹窗之后，且弹窗打开时跳过，
   保证 Esc 只关闭最上层 */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

/* ---------- 意见反馈 ---------- */
// readingId: the reading this feedback is about (null when opened from the footer link)
let feedbackReadingId = null;
function openFeedbackModal(readingId = null) {
  feedbackReadingId = readingId;
  $("feedback-error").hidden = true;
  $("feedback-ok").hidden = true;
  $("feedback-modal").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeFeedbackModal() {
  $("feedback-modal").hidden = true;
  // 只有其他弹窗都关了才恢复滚动
  if ($("card-modal").hidden && $("journal-modal").hidden && $("auth-modal").hidden && $("share-modal").hidden) {
    document.body.style.overflow = "";
  }
}

if ($("feedback-modal")) {
  $("feedback-link").addEventListener("click", (e) => {
    e.preventDefault();
    openFeedbackModal(null);
  });
  // “反馈这次解读”按钮：解读完成后出现，反馈关联到这次解读
  if ($("feedback-reading")) {
    $("feedback-reading").addEventListener("click", () => openFeedbackModal(currentReadingId));
  }
  $("feedback-close").addEventListener("click", closeFeedbackModal);
  $("feedback-modal").addEventListener("click", (e) => {
    if (e.target.id === "feedback-modal") closeFeedbackModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("lightbox").hidden && !$("feedback-modal").hidden) closeFeedbackModal();
  });
  $("feedback-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("feedback-error"), okEl = $("feedback-ok"), btn = $("feedback-submit");
    errEl.hidden = true;
    okEl.hidden = true;
    const message = $("feedback-msg").value.trim();
    if (message.length < 10) {
      errEl.hidden = false;
      errEl.textContent = t("app.feedback.too_short");
      return;
    }
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = t("html.feedback.sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          userId: moonlitUserId,
          category: $("feedback-cat").value,
          contact: $("feedback-contact").value.trim(),
          message,
          readingId: feedbackReadingId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("app.feedback.failed"));
      $("feedback-msg").value = "";
      $("feedback-contact").value = "";
      okEl.hidden = false;
      okEl.textContent = t("app.feedback.success");
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message || t("app.feedback.failed");
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  });
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

  await refreshHistoryList();
}

// i18n: extracted so the language toggle can re-render the list in place
async function refreshHistoryList() {
  const list = $("history-list");
  list.innerHTML = t("app.history.loading");
  try {
    const res = await fetch("/api/user/readings?userId=" + encodeURIComponent(moonlitUserId || ""),
      { headers: authHeaders() });
    const data = await res.json();
    const items = data.readings || [];
    list.innerHTML = "";
    // 游客提示：登录后历史云同步 100 条，换设备不丢失
    if (!window.__moonlitMember) {
      const tip = el("p", "hint history-login-tip", t("app.history.login_tip"));
      list.appendChild(tip);
      tip.querySelector("#history-login-link").addEventListener("click", (e) => {
        e.preventDefault();
        openAuthModal();
      });
    }
    if (items.length === 0) {
      list.innerHTML = t("app.history.empty");
      return;
    }
    items.forEach((r) => {
      const details = el("details", "history-item");
      const date = new Date(r.created_at).toLocaleString(getLang() === "en" ? "en-US" : "zh-CN", { hour12: false });
      const summary = el("summary", null,
        "<span class='history-q'>" + escapeHtml(r.question) + "</span>" +
        "<span class='history-meta'>" + escapeHtml(spreadDisplayName(r)) + " · " + date + "</span>");
      const body = el("div", "history-body");
      body.innerHTML = t("app.history.loading");
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
            escapeHtml(spreadPosName(full.spread_key, c.position) + " · " + zhCardName(c) + (c.orientation === "reversed" ? t("app.draw.cap_reversed") : ""))).join("<br>");
          let fuHtml = "";
          if (full.followups && full.followups.length) {
            fuHtml = t("app.history.followup_title") +
              full.followups.map((f) =>
                "<div class='fu-q'>" + t("app.followup.you_asked") + escapeHtml(f.question) + "</div>" +
                "<div class='fu-a'>" + t("app.followup.moonlit_says") + escapeHtml(f.answer).replace(/\n/g, "<br>") + "</div>"
              ).join("") + "</div>";
          }
          body.innerHTML =
            "<div class='history-cards'>" + cardNames + "</div>" +
            "<div class='reading'>" + escapeHtml(full.reading_text).replace(/\n/g, "<br>") + "</div>" +
            fuHtml;
          // 牌面缩略图：不用去牌鉴翻，点击直接放大
          const thumbs = el("div", "history-thumbs");
          (full.cards || []).forEach((c) => {
            const nm = zhCardName(c);
            const isRev = c.orientation === "reversed";
            thumbs.appendChild(cardThumb(c.id,
              (c.position ? spreadPosName(full.spread_key, c.position) + " · " : "") + nm + t(isRev ? "app.draw.cap_reversed" : "app.draw.cap_upright"), isRev));
          });
          if (thumbs.children.length) body.insertBefore(thumbs, body.firstChild);
          body.dataset.loaded = "1";
        } catch (e) {
          body.innerHTML = t("app.history.load_failed");
        }
      });
      list.appendChild(details);
    });
  } catch (e) {
    list.innerHTML = t("app.history.network_failed");
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
let currentReadingId = null; // set when a real reading completes (for follow-ups)
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

  // 牌阵（超过 5 张时分多行：凯尔特十字排成两行）
  if (cards && cards.length) {
    const gap = 28;
    const perRow = 5;
    for (let r = 0; r * perRow < cards.length; r++) {
      const rowCards = cards.slice(r * perRow, r * perRow + perRow);
      const n = rowCards.length;
      const cw = Math.min(300, (W - 180 - gap * (n - 1)) / n);
      const ch = cw * 1.5;
      const totalW = cw * n + gap * (n - 1);
      let x = (W - totalW) / 2;
      const imgs = await Promise.all(
        rowCards.map((c) => loadImg("img/cards/" + c.id + ".webp").catch(() => null))
      );
      imgs.forEach((img, i) => {
        if (img) {
          if (rowCards[i].reversed) {
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
        let nm = zhCardName(rowCards[i]) + (rowCards[i].reversed ? t("app.share.card_label_reversed") : "");
        if (nm.length > 16) nm = nm.slice(0, 15) + "…";
        ctx.fillText(nm, x + cw / 2, y + ch + 44);
        x += cw + gap;
      });
      y += ch + 96;
    }
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
    ctx.fillText(t("app.share.qr_caption"), W / 2, qy + qs + 60);
  } else {
    ctx.fillStyle = "#f0d98c";
    ctx.font = "33px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.fillText(t("app.share.qr_caption_short"), W / 2, zoneY + 130);
  }
  ctx.fillStyle = "#9a94b8";
  ctx.font = "30px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(location.origin, W / 2, zoneY + 336);

  // 落款
  ctx.fillStyle = "#d4af37";
  ctx.font = "34px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(footer || t("app.share.footer_default"), W / 2, H - 88);

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
  const text = t("app.share.copy_text", { link });
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = t("app.share.copied");
    setTimeout(() => (btn.textContent = old), 2000);
  } catch (e) {
    prompt(t("app.share.copy_prompt"), text);
  }
});

$("share-native").addEventListener("click", async () => {
  try {
    const blob = await new Promise((r) => shareCanvas.toBlob(r, "image/png"));
    const file = new File([blob], "moonlit-tarot.png", { type: "image/png" });
    await navigator.share({ files: [file], title: t("app.share.brand"),
      text: t("app.share.native_text", { link: location.origin }) });
  } catch (e) {
    /* 用户取消了分享 */
  }
});

$("share-reading").addEventListener("click", async () => {
  const btn = $("share-reading");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = t("app.share.rendering");
  try {
    const canvas = await renderShareCanvas({
      title: t("app.share.brand"),
      subtitle: t("app.share.subtitle_question", { q: state.question }),
      cards: state.drawn.map((d) => ({
        id: d.card.id,
        name: d.card.name,
        reversed: d.reversed,
      })),
      bodyText: lastReadingText,
      footer: t("app.share.footer_reading"),
    });
    openShareModal(canvas);
  } catch (e) {
    alert(t("app.share.error"));
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
  const meaning = cardMeaning(card, reversed ? "reversed" : "upright");

  $("daily-date").textContent = t("app.daily.date", { m: d.getMonth() + 1, d: d.getDate() });
  const art = $("daily-art");
  art.src = "img/cards/" + card.id + ".webp";
  art.alt = zhCardName(card);
  art.style.transform = reversed ? "rotate(180deg)" : "";
  $("daily-name").textContent = zhCardName(card);
  $("daily-orient").textContent = t(reversed ? "app.draw.reversed" : "app.draw.upright");
  $("daily-meaning").textContent = t(reversed ? "app.draw.reversed_dot" : "app.draw.upright_dot") + meaning;
  /* Fortune line rotates daily (8 templates) so it doesn't feel samey. */
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  $("daily-fortune").textContent = t("app.daily.fortune_" + (dayOfYear % 8), { meaning });

  dailyCardData = { card, reversed, meaning };
  art.onclick = () => openLightbox(art.src,
    zhCardName(card) + t(reversed ? "app.draw.cap_reversed" : "app.draw.cap_upright"), reversed);
}

$("daily-share").addEventListener("click", async () => {
  if (!dailyCardData) return;
  const btn = $("daily-share");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = t("app.share.rendering");
  try {
    const { card, reversed, meaning } = dailyCardData;
    const canvas = await renderShareCanvas({
      title: t("app.share.title_daily"),
      subtitle: t("app.share.subtitle_daily", {
        date: $("daily-date").textContent,
        name: zhCardName(card),
        rev: reversed ? t("app.draw.cap_reversed") : t("app.draw.cap_upright"),
      }),
      cards: [{ id: card.id, name: card.name, reversed }],
      bodyText: t("app.share.daily_body", {
        rev: reversed ? t("app.draw.reversed_dot") : t("app.draw.upright_dot"),
        meaning,
      }),
      footer: t("app.share.footer_daily"),
    });
    openShareModal(canvas);
  } catch (e) {
    alert(t("app.share.error"));
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
  $("auth-submit").textContent = t(mode === "login" ? "app.auth.login" : "app.auth.register");
  $("auth-password2").hidden = mode === "login";
  $("auth-code-row").hidden = mode === "login";
  $("auth-code").required = mode === "register";
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
// growth.js 的游客引导（签到/分享）需要能打开登录弹窗
window.__openAuthModal = openAuthModal;
$("auth-close").addEventListener("click", closeAuthModal);
$("auth-modal").addEventListener("click", (e) => {
  if (e.target === $("auth-modal")) closeAuthModal();
});
$("auth-tab-login").addEventListener("click", () => setAuthMode("login"));
$("auth-tab-register").addEventListener("click", () => setAuthMode("register"));

// 发送邮箱验证码（注册用），60 秒倒计时防连点
let codeCountdown = null;
function startCodeCountdown(sec) {
  const btn = $("auth-send-code");
  clearInterval(codeCountdown);
  btn.disabled = true;
  btn.textContent = t("app.auth.countdown", { sec });
  codeCountdown = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(codeCountdown);
      btn.disabled = false;
      btn.textContent = t("app.auth.send_code");
    } else {
      btn.textContent = t("app.auth.countdown", { sec });
    }
  }, 1000);
}
$("auth-send-code").addEventListener("click", async () => {
  hideAuthError();
  const email = $("auth-email").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError(t("app.auth.err_invalid_email"));
    $("auth-email").focus();
    return;
  }
  const btn = $("auth-send-code");
  btn.disabled = true;
  btn.textContent = t("app.auth.sending");
  try {
    const res = await fetch("/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose: "register" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("app.auth.err_send_failed"));
    startCodeCountdown(60);
  } catch (err) {
    showAuthError(err.message);
    btn.disabled = false;
    btn.textContent = t("app.auth.send_code");
  }
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  if (authMode === "register" && password !== $("auth-password2").value) {
    showAuthError(t("app.auth.err_password_mismatch"));
    return;
  }
  const code = authMode === "register" ? $("auth-code").value.trim() : undefined;
  if (authMode === "register" && !/^\d{6}$/.test(code)) {
    showAuthError(t("app.auth.err_code"));
    return;
  }
  const btn = $("auth-submit");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = t("app.auth.please_wait");
  try {
    const res = await fetch("/api/auth/" + authMode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, userId: moonlitUserId, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("app.auth.err_generic"));
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

/* ============================================================
   语言切换：重渲染 JS 动态生成的内容
   （静态 HTML 由 i18n.js 的 data-i18n 自动处理）
   ============================================================ */
document.addEventListener("moonlit-lang-change", () => {
  try {
    // 每日一牌（同一张牌，换语言重渲染）
    if (typeof renderDailyCard === "function") renderDailyCard();
    // 牌鉴
    const grid = $("gallery-grid");
    if (grid) { grid.innerHTML = ""; buildGallery(); }
    // 历史记录（仅当历史面板可见时）
    if ($("step-history") && !$("step-history").hidden && typeof refreshHistoryList === "function") {
      refreshHistoryList();
    }
    // 正在抽牌中的牌位标签
    if ($("step-draw") && !$("step-draw").hidden && state.drawn.length) {
      document.querySelectorAll("#drawn .pos-tag").forEach((tag, i) => {
        if (state.drawn[i]) tag.textContent = spreadPosName(state.spreadKey, state.drawn[i].position);
      });
    }
    // 登录/注册按钮文案（data-i18n 会把它重置成登录，需按当前 tab 恢复）
    if (typeof setAuthMode === "function") setAuthMode(authMode);
  } catch (e) { /* 重渲染失败不影响主流程 */ }
});
