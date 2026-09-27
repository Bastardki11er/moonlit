/* ============================================================
   Moonlit — divination frontend (bazi / ziwei / astro / journal)
   ------------------------------------------------------------
   Tab navigation, birth-data forms, chart rendering (bazi pillars,
   ziwei 4x4 palace grid, western SVG chart wheel) and the reading
   journal. Works alongside js/app.js (tarot); shares its user id
   (localStorage moonlit_uid) and login token.
   ============================================================ */
(function () {
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
const uid = () => { try { return localStorage.getItem("moonlit_uid") || ""; } catch (e) { return ""; } };
function authHeaders() {
  try {
    const t = localStorage.getItem("moonlit_token");
    return t ? { Authorization: "Bearer " + t } : {};
  } catch (e) { return {}; }
}
async function api(path, opts) {
  opts = opts || {};
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(), opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "请求失败，请重试。");
  return data;
}
const para = (t) => esc(t).replace(/\n/g, "<br>");

/* ---------------- view tabs ---------------- */
const VIEW_TITLES = { home: "首页", tarot: "塔罗占卜", bazi: "八字排盘", ziwei: "紫微斗数", astro: "西方星盘", journal: "占卜日记" };
function switchView(name) {
  document.querySelectorAll("#topnav [data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "view-" + name; });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "journal") loadJournal();
  if (name === "bazi") loadMiniHistory("bazi");
  if (name === "ziwei") loadMiniHistory("ziwei");
  if (name === "astro") loadMiniHistory("astro");
}
document.querySelectorAll("#topnav [data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

/* 首页功能磁贴 → 跳转到对应视图 */
document.querySelectorAll(".feature-tile[data-goto]").forEach((tile) => {
  tile.addEventListener("click", () => switchView(tile.dataset.goto));
});

/* ---------------- birth form ---------------- */
const SHICHEN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const shichenOf = (h) => SHICHEN[Math.floor(((h + 1) % 24) / 2)];


function hourOptions() {
  let s = '<option value="">请选择</option>';
  for (let h = 0; h < 24; h++) s += `<option value="${h}">${h}点（${shichenOf(h)}时）</option>`;
  return s;
}


function birthFormHTML(p) {
  return `
  <form id="${p}-form" class="birth-form" novalidate>
    <div class="form-row">
      <label class="form-label">性别</label>
      <div class="pill-group">
        <label class="pill"><input type="radio" name="${p}-gender" value="male" checked /><span>男</span></label>
        <label class="pill"><input type="radio" name="${p}-gender" value="female" /><span>女</span></label>
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">出生日期</label>
      <div class="date-inputs">
        <input id="${p}-year" type="number" min="1900" max="2026" placeholder="年 · 如1995" />
        <input id="${p}-month" type="number" min="1" max="12" placeholder="月" />
        <input id="${p}-day" type="number" min="1" max="31" placeholder="日" />
      </div>
      <div class="pill-group" style="margin-top:8px">
        <label class="pill"><input type="radio" name="${p}-cal" value="solar" checked /><span>阳历</span></label>
        <label class="pill"><input type="radio" name="${p}-cal" value="lunar" /><span>农历</span></label>
        <label class="pill check"><input type="checkbox" id="${p}-leap" /><span>闰月</span></label>
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">出生时间</label>
      <div class="date-inputs">
        <select id="${p}-hour">${hourOptions()}</select>
        <select id="${p}-minute">
          <option value="">分钟不详</option>
          <option value="0">00分</option><option value="15">15分</option>
          <option value="30" selected>30分</option><option value="45">45分</option>
        </select>
      </div>
    </div>
    ${p === "astro" ? `
    <p class="hint">注：星盘解读以行星星座与相位为主，不含上升点与宫位划分。</p>` : ""}
    <div class="form-row">
      <label class="form-label">想重点了解 <span class="hint-inline">（可选）</span></label>
      <input id="${p}-question" maxlength="200" placeholder="比如：今年事业运如何？" />
    </div>
    <p class="form-error" id="${p}-error" hidden></p>
    <button type="submit" class="cta" id="${p}-submit">🔮 排出命盘</button>
    <p class="hint">排盘消耗 1 次免费额度 · 仅供娱乐与自我探索</p>
  </form>`;
}

function readBirthForm(p) {
  const err = (m) => { const e = $(p + "-error"); e.textContent = m; e.hidden = false; throw new Error(m); };
  $(p + "-error").hidden = true;
  const gender = (document.querySelector(`input[name="${p}-gender"]:checked`) || {}).value;
  if (!gender) err("请选择性别。");
  const y = parseInt($(p + "-year").value, 10);
  const mo = parseInt($(p + "-month").value, 10);
  const d = parseInt($(p + "-day").value, 10);
  const h = $(p + "-hour").value === "" ? null : parseInt($(p + "-hour").value, 10);
  if (!y || !mo || !d) err("请填写完整的出生日期。");
  if (h === null) err("请选择出生时辰（大约几点）。");
  const body = {
    userId: uid(),
    gender,
    birthYear: y, birthMonth: mo, birthDay: d, birthHour: h,
    calendarType: (document.querySelector(`input[name="${p}-cal"]:checked`) || {}).value || "solar",
    isLeapMonth: $(p + "-leap").checked,
    question: $(p + "-question").value.trim(),
  };
  const min = $(p + "-minute").value;
  if (min !== "") body.birthMinute = parseInt(min, 10);
  return body;
}

/* ---------------- 出生信息记忆（注册用户专享） ---------------- */
const isLoggedIn = () => {
  try { return !!localStorage.getItem("moonlit_token"); } catch (e) { return false; }
};
let birthProfileCache = null; // null=未加载，false=无或游客

async function getBirthProfile() {
  if (birthProfileCache !== null) return birthProfileCache || null;
  if (!isLoggedIn()) { birthProfileCache = false; return null; }
  try {
    const d = await api("/api/profile/birth");
    birthProfileCache = d.profile || false;
  } catch (e) { birthProfileCache = false; }
  return birthProfileCache || null;
}

function initBirthMemory(p) {
  const wrap = $(p + "-form-wrap");
  if (!wrap) return;
  let bar = $(p + "-memory-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = p + "-memory-bar";
    bar.className = "birth-memory-bar";
    bar.hidden = true;
    wrap.prepend(bar);
  }
  getBirthProfile().then((prof) => {
    if (prof) {
      bar.hidden = false;
      bar.innerHTML =
        `🎂 检测到你保存的出生信息 ` +
        `<button type="button" class="ghost small" id="${p}-fill-profile">⚡ 一键填入</button>`;
      const btn = $(p + "-fill-profile");
      if (btn) btn.addEventListener("click", () => fillBirthForm(p, prof));
    } else if (!isLoggedIn()) {
      bar.hidden = false;
      bar.innerHTML = `<span class="hint">👑 登录后可记住出生信息，下次排盘一键填入</span>`;
    } else {
      bar.hidden = true;
    }
  });
  // "记住这次"复选框（登录态变化时增删）
  const form = $(p + "-form");
  let label = $(p + "-remember-label");
  if (isLoggedIn() && !label && form) {
    label = document.createElement("label");
    label.className = "remember-birth";
    label.id = p + "-remember-label";
    label.innerHTML = `<input type="checkbox" id="${p}-remember" checked /> 记住这次的出生信息，下次一键填入`;
    form.insertBefore(label, $(p + "-submit"));
  } else if (!isLoggedIn() && label) {
    label.remove();
  }
}

/* 登录/退出后刷新（app.js 的 setLoggedIn/setLoggedOut 会调用） */
window.__refreshBirthMemory = function () {
  birthProfileCache = null;
  initBirthMemory("bazi");
  initBirthMemory("ziwei");
  initBirthMemory("astro");
};

function fillBirthForm(p, prof) {
  const setRadio = (name, val) => {
    document.querySelectorAll(`input[name="${p}-${name}"]`).forEach((r) => { r.checked = r.value === val; });
  };
  setRadio("gender", prof.gender === "female" ? "female" : "male");
  $(p + "-year").value = prof.birth_year || "";
  $(p + "-month").value = prof.birth_month || "";
  $(p + "-day").value = prof.birth_day || "";
  setRadio("cal", prof.calendar_type === "lunar" ? "lunar" : "solar");
  $(p + "-leap").checked = !!prof.is_leap_month;
  $(p + "-hour").value = String(prof.birth_hour);
  if (prof.birth_minute !== null && prof.birth_minute !== undefined) {
    $(p + "-minute").value = String(prof.birth_minute);
  }
}

/* 排盘成功后：如果勾了"记住"，把这次的出生信息存下来（失败不打扰） */
async function maybeSaveBirthProfile(p, kind, body) {
  try {
    const box = $(p + "-remember");
    if (!box || !box.checked || !isLoggedIn()) return;
    const payload = Object.assign({ kind }, body);
    delete payload.userId; delete payload.question;
    await api("/api/profile/birth", { method: "POST", body: payload });
    birthProfileCache = null;
  } catch (e) { /* ignore */ }
}

/* ---------------- bazi ---------------- */
$("bazi-form-wrap").innerHTML = birthFormHTML("bazi");
initBirthMemory("bazi");
$("bazi-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let body;
  try { body = readBirthForm("bazi"); } catch (err) { return; }
  const btn = $("bazi-submit");
  btn.disabled = true; btn.textContent = "排盘中…";
  try {
    const data = await api("/api/divination/bazi", { method: "POST", body });
    renderBaziResult(data);
    maybeSaveBirthProfile("bazi", "bazi", body);
    loadMiniHistory("bazi");
  } catch (err) {
    const el = $("bazi-error"); el.textContent = err.message; el.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "🔮 排出命盘";
  }
});

let lastBazi = null;
function renderBaziResult(data) {
  lastBazi = data;
  const chart = data.chart || {};
  const info = chart["基本信息"] || {};
  const pillars = chart["四柱"] || [];
  const relations = chart["干支关系"] || [];
  $("bazi-pillars").innerHTML =
    `<div class="pillars-head">日主 <b>${esc(info["日主"] || "")}</b> · ${esc(info["性别"] || "")}</div>` +
    '<div class="pillars-grid">' + pillars.map((pl) => {
      const gz = String(pl["干支"] || "");
      const canggan = (pl["藏干"] || []).map((c) => `${esc(c["天干"])}(${esc(c["十神"])})`).join(" ");
      return `<div class="pillar">
        <div class="pillar-title">${esc(pl["柱"])}</div>
        <div class="pillar-gz"><span class="gan">${esc(gz[0] || "")}</span><span class="zhi">${esc(gz[1] || "")}</span></div>
        <div class="pillar-god">${esc(pl["天干十神"] || "")}</div>
        <div class="pillar-sub">藏干 ${esc(canggan) || "—"}</div>
        <div class="pillar-sub">${esc(pl["地势"] || "")}${pl["空亡"] === "是" ? ' · <span class="kong">空亡</span>' : ""}</div>
      </div>`;
    }).join("") + "</div>";
  $("bazi-relations").textContent = relations.length ? "干支关系：" + relations.join("；") : "";
  $("bazi-reading").innerHTML = para(data.reading);
  $("bazi-result").hidden = false;
  $("bazi-result").scrollIntoView({ behavior: "smooth" });
}
$("bazi-again").addEventListener("click", () => {
  $("bazi-result").hidden = true;
  $("bazi-form-wrap").scrollIntoView({ behavior: "smooth" });
});
$("bazi-journal").addEventListener("click", () => {
  if (!lastBazi) return;
  openJournalEditor({ mode: "new", link: { kind: "bazi", refId: lastBazi.id, label: `八字排盘 #${lastBazi.id}` } });
});

/* ---------------- ziwei ---------------- */
$("ziwei-form-wrap").innerHTML = birthFormHTML("ziwei");
initBirthMemory("ziwei");
$("ziwei-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let body;
  try { body = readBirthForm("ziwei"); } catch (err) { return; }
  const btn = $("ziwei-submit");
  btn.disabled = true; btn.textContent = "排盘中…";
  try {
    const data = await api("/api/divination/ziwei", { method: "POST", body });
    renderZiweiResult(data);
    maybeSaveBirthProfile("ziwei", "ziwei", body);
    loadMiniHistory("ziwei");
  } catch (err) {
    const el = $("ziwei-error"); el.textContent = err.message; el.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "🔮 排出命盘";
  }
});

let lastZiwei = null;
// 传统命盘按地支定位：4x4，外圈12格，中间2x2放基本信息
const ZW_LAYOUT = [
  ["巳", "午", "未", "申"],
  ["辰", null, null, "酉"],
  ["卯", null, null, "戌"],
  ["寅", "丑", "子", "亥"],
];
function renderZiweiResult(data) {
  lastZiwei = data;
  const chart = data.chart || {};
  const info = chart["基本信息"] || {};
  const palaces = chart["十二宫位"] || [];
  const byBranch = {};
  palaces.forEach((pl) => {
    const gz = String(pl["干支"] || "");
    const branch = gz[1];
    if (branch) byBranch[branch] = pl;
  });
  const cellHTML = (branch) => {
    if (!branch) return `<div class="zw-center">
      <div class="zw-center-title">紫微命盘</div>
      <div>命主 ${esc(info["命主"] || "")} · 身主 ${esc(info["身主"] || "")}</div>
      <div>${esc(info["五行局"] || "")}</div>
      <div class="hint-inline">${esc(info["四柱"] || "")}</div>
    </div>`;
    const pl = byBranch[branch];
    if (!pl) return `<div class="zw-cell empty"></div>`;
    const isSoul = pl["宫位"] === "命宫";
    const isBody = pl["是否身宫"] === "是";
    const majors = (pl["主星及四化"] || []).map((s) =>
      `<span class="zw-major">${esc(s["星名"])}${s["亮度"] ? `<i>${esc(s["亮度"])}</i>` : ""}</span>`).join("");
    const minors = (pl["辅星"] || []).map((s) => esc(s["星名"])).join(" ");
    return `<div class="zw-cell${isSoul ? " soul" : ""}${isBody ? " body" : ""}">
      <div class="zw-palace">${esc(pl["宫位"])}${isSoul ? " ★" : ""}${isBody && !isSoul ? " ◉" : ""}</div>
      <div class="zw-gz">${esc(pl["干支"])}</div>
      <div class="zw-stars">${majors || '<span class="hint-inline">无主星</span>'}</div>
      <div class="zw-minors">${esc(minors)}</div>
      <div class="zw-range">${esc(pl["大限"] || "")}</div>
    </div>`;
  };
  $("ziwei-grid").innerHTML = ZW_LAYOUT.map((row) =>
    `<div class="zw-row">${row.map(cellHTML).join("")}</div>`).join("");
  $("ziwei-reading").innerHTML = para(data.reading);
  $("ziwei-result").hidden = false;
  $("ziwei-result").scrollIntoView({ behavior: "smooth" });
}
$("ziwei-again").addEventListener("click", () => {
  $("ziwei-result").hidden = true;
  $("ziwei-form-wrap").scrollIntoView({ behavior: "smooth" });
});
$("ziwei-journal").addEventListener("click", () => {
  if (!lastZiwei) return;
  openJournalEditor({ mode: "new", link: { kind: "ziwei", refId: lastZiwei.id, label: `紫微斗数 #${lastZiwei.id}` } });
});

/* ---------------- astro ---------------- */
$("astro-form-wrap").innerHTML = birthFormHTML("astro");
initBirthMemory("astro");
$("astro-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let body;
  try { body = readBirthForm("astro"); } catch (err) { return; }
  const btn = $("astro-submit");
  btn.disabled = true; btn.textContent = "排盘中…";
  try {
    const data = await api("/api/divination/astro", { method: "POST", body });
    renderAstroResult(data);
    maybeSaveBirthProfile("astro", "astro", body);
    loadMiniHistory("astro");
  } catch (err) {
    const el = $("astro-error"); el.textContent = err.message; el.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "🔮 排出命盘";
  }
});

let lastAstro = null;
const PLANET_GLYPH = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇" };
const SIGN_GLYPH = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const ASPECT_COLOR = { conjunction: "#e64980", opposition: "#e03131", square: "#f08c00", trine: "#1971c2", sextile: "#2f9e44" };

function renderAstroResult(data) {
  lastAstro = data;
  drawWheel($("astro-wheel"), data.extra);
  const bodies = (data.extra && data.extra.bodies) || [];
  $("astro-points").innerHTML = bodies.map((b) =>
    `<div class="astro-point"><span class="ap-glyph">${PLANET_GLYPH[b.key] || "✦"}</span>
     <span class="ap-name">${esc(b.label)}</span>
     <span class="hint-inline">${esc(b.sign)} ${esc(b.degInSign)} · ${b.house ? "第" + b.house + "宫" : ""}</span></div>`
  ).join("");
  $("astro-reading").innerHTML = para(data.reading);
  $("astro-result").hidden = false;
  $("astro-result").scrollIntoView({ behavior: "smooth" });
}

function drawWheel(svg, extra) {
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  if (!extra || !extra.bodies || !extra.bodies.length) {
    svg.innerHTML = '<text x="200" y="200" text-anchor="middle" fill="#8b8fa3">星盘数据缺失</text>';
    return;
  }
  // 无出生地时没有上升点：以白羊座 0° 为左侧起点绘制，不画 ASC 标记与宫位线
  const asc = extra.ascLon === null || extra.ascLon === undefined ? 0 : extra.ascLon;
  const hasAsc = extra.ascLon !== null && extra.ascLon !== undefined;
  const C = 200;
  const P = (lon, r) => {
    const rad = (180 - (lon - asc)) * Math.PI / 180;
    return [C + r * Math.cos(rad), C - r * Math.sin(rad)];
  };
  const mk = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(n);
    return n;
  };
  const line = (lon1, r1, lon2, r2, attrs) => {
    const [x1, y1] = P(lon1, r1), [x2, y2] = P(lon2, r2);
    return mk("line", Object.assign({ x1, y1, x2, y2 }, attrs));
  };
  // rings
  [190, 155, 105].forEach((r) => mk("circle", { cx: C, cy: C, r, fill: "none", stroke: "#3a3f5c", "stroke-width": r === 190 ? 2 : 1 }));
  // sign divisions + glyphs
  for (let i = 0; i < 12; i++) {
    line(i * 30, 190, i * 30, 155, { stroke: "#3a3f5c", "stroke-width": 1 });
    const [gx, gy] = P(i * 30 + 15, 172);
    const t = mk("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 14, fill: "#aab" });
    t.textContent = SIGN_GLYPH[i];
  }
  // house cusps
  (extra.houses || []).forEach((h) => {
    const isAsc = Math.abs(((h.startLon - asc) % 360 + 360) % 360) < 0.5;
    line(h.startLon, 155, h.startLon, 105, { stroke: isAsc ? "#ffd97a" : "#4a5170", "stroke-width": isAsc ? 2.5 : 1 });
    const mid = h.startLon + 15;
    const [nx, ny] = P(mid, 128);
    const t = mk("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "#777d99" });
    t.textContent = h.id;
  });
  // ASC marker（无出生地时不画）
  if (hasAsc) {
    const [ax, ay] = P(asc, 190);
    const t = mk("text", { x: ax - 2, y: ay, "text-anchor": "end", "dominant-baseline": "central", "font-size": 11, fill: "#ffd97a", "font-weight": "bold" });
    t.textContent = "ASC";
  }
  // planets (decluttered display longitudes, lines to true positions)
  const bodies = (extra.bodies || []).slice().sort((a, b) => a.lon - b.lon);
  const disp = [];
  bodies.forEach((b, i) => {
    let l = b.lon;
    if (i > 0) l = Math.max(l, disp[i - 1] + 9);
    disp.push(l);
  });
  for (let i = bodies.length - 2; i >= 0; i--) {
    if (disp[i + 1] - disp[i] < 9) disp[i] = disp[i + 1] - 9;
  }
  const lonByKey = {};
  bodies.forEach((b, i) => {
    lonByKey[b.key] = b.lon;
    const [px, py] = P(disp[i], 132);
    const t = mk("text", { x: px, y: py, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 16, fill: "#e8e4f5" });
    t.textContent = PLANET_GLYPH[b.key] || "✦";
    const tip = mk("title", {}, t);
    tip.textContent = `${b.label} ${b.sign}${b.degInSign}`;
    // tick from glyph ring to true position
    line(disp[i], 126, b.lon, 112, { stroke: "#4a5170", "stroke-width": 1 });
  });
  // aspects
  const seen = new Set();
  (extra.aspects || []).forEach((a) => {
    if (lonByKey[a.from] === undefined || lonByKey[a.to] === undefined) return;
    const k = [a.from, a.to].sort().join("|");
    if (seen.has(k)) return;
    seen.add(k);
    const color = ASPECT_COLOR[a.type] || "#888";
    const [x1, y1] = P(lonByKey[a.from], 100);
    const [x2, y2] = P(lonByKey[a.to], 100);
    mk("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 1.4, opacity: Math.max(0.35, 1 - (a.orb || 0) / 8) });
  });
}
$("astro-again").addEventListener("click", () => {
  $("astro-result").hidden = true;
  $("astro-form-wrap").scrollIntoView({ behavior: "smooth" });
});
$("astro-journal").addEventListener("click", () => {
  if (!lastAstro) return;
  openJournalEditor({ mode: "new", link: { kind: "astro", refId: lastAstro.id, label: `西方星盘 #${lastAstro.id}` } });
});

/* ---------------- mini history (per kind) ---------------- */
async function loadMiniHistory(kind) {
  const box = $(kind + "-history");
  if (!box) return;
  try {
    const data = await api(`/api/divination/history?kind=${kind}&userId=${encodeURIComponent(uid())}`);
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((it) =>
      `<button class="mini-item" data-id="${it.id}">
        <span class="mini-date">${esc((it.created_at || "").slice(0, 10))}</span>
        <span class="mini-q">${esc(it.question || "（未留问题）")}</span>
      </button>`).join("")
      : `<p class="hint">还没有${VIEW_TITLES[kind]}记录，排一张试试吧 ✨</p>`;
    box.querySelectorAll(".mini-item").forEach((b) =>
      b.addEventListener("click", () => openDivinationDetail(kind, b.dataset.id)));
  } catch (e) {
    box.innerHTML = `<p class="hint">加载失败，请重试。</p>`;
  }
}
async function openDivinationDetail(kind, id) {
  try {
    const d = await api(`/api/divination/${kind}/${id}?userId=${encodeURIComponent(uid())}`);
    switchView(kind);
    if (kind === "bazi") renderBaziResult(d);
    else if (kind === "ziwei") renderZiweiResult(d);
    else renderAstroResult(d);
  } catch (e) { alert(e.message); }
}

/* ---------------- journal ---------------- */
const MOODS = [["开心", "😊"], ["平静", "😌"], ["迷茫", "😕"], ["难过", "😢"], ["期待", "🤩"], ["感恩", "🙏"]];
const KIND_LABEL = { note: "随笔", tarot: "塔罗", bazi: "八字", ziwei: "紫微", astro: "星盘" };
let journalState = { mode: "new", id: null, link: null, mood: "" };

$("journal-new").addEventListener("click", () => openJournalEditor({ mode: "new" }));

async function loadJournal() {
  const box = $("journal-list");
  box.innerHTML = `<p class="hint">加载中…</p>`;
  try {
    const data = await api(`/api/journal?userId=${encodeURIComponent(uid())}`);
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((it) =>
      `<button class="journal-card" data-id="${it.id}">
        <div class="jc-top"><span class="jc-kind">${KIND_LABEL[it.kind] || "随笔"}</span>
        ${it.mood ? `<span class="jc-mood">${esc(it.mood)}</span>` : ""}
        <span class="jc-date">${esc((it.created_at || "").slice(0, 10))}</span></div>
        ${it.title ? `<div class="jc-title">${esc(it.title)}</div>` : ""}
        <div class="jc-excerpt">${esc(it.excerpt || "")}${(it.excerpt || "").length >= 120 ? "…" : ""}</div>
      </button>`).join("")
      : `<div class="journal-empty"><p>📓 还没有日记</p><p class="hint">占卜之后点"记到日记"，或直接写一篇，记录此刻的心情。</p></div>`;
    box.querySelectorAll(".journal-card").forEach((c) =>
      c.addEventListener("click", () => openJournalEntry(c.dataset.id)));
  } catch (e) {
    box.innerHTML = `<p class="hint">加载失败，请重试。</p>`;
  }
}

function renderMoods(selected) {
  $("journal-moods").innerHTML = MOODS.map(([m, e]) =>
    `<button type="button" class="mood${m === selected ? " sel" : ""}" data-mood="${m}">${e} ${m}</button>`).join("");
  $("journal-moods").querySelectorAll(".mood").forEach((b) =>
    b.addEventListener("click", () => {
      journalState.mood = journalState.mood === b.dataset.mood ? "" : b.dataset.mood;
      renderMoods(journalState.mood);
    }));
}

function openJournalEditor(opts) {
  opts = opts || {};
  journalState = { mode: opts.mode || "new", id: opts.id || null, link: opts.link || null, mood: opts.mood || "" };
  $("journal-modal-title").textContent = journalState.mode === "new" ? "✏️ 写日记" : "📓 日记";
  const li = $("journal-link-info");
  if (journalState.link) {
    li.hidden = false;
    li.textContent = `关联解读：${journalState.link.label}（保存后自动关联）`;
  } else li.hidden = true;
  $("journal-title").value = opts.title || "";
  $("journal-content").value = opts.content || "";
  $("journal-content").hidden = false;
  $("journal-readonly").hidden = true;
  $("journal-error").hidden = true;
  renderMoods(journalState.mood);
  setJournalMode(journalState.mode === "new" ? "edit" : "view");
  $("journal-modal").hidden = false;
}

function setJournalMode(m) {
  const editing = m === "edit";
  $("journal-title").disabled = !editing;
  $("journal-content").hidden = !editing;
  $("journal-readonly").hidden = editing;
  $("journal-moods").style.display = editing ? "" : "none";
  $("journal-save").hidden = !editing;
  $("journal-edit").hidden = editing;
  $("journal-delete").hidden = editing || !journalState.id;
}

async function openJournalEntry(id) {
  try {
    const e = await api(`/api/journal/${id}?userId=${encodeURIComponent(uid())}`);
    journalState = { mode: "view", id: e.id, link: null, mood: e.mood || "", raw: e.content || "" };
    $("journal-modal-title").textContent = "📓 日记";
    $("journal-link-info").hidden = true;
    $("journal-title").value = e.title || "";
    $("journal-readonly").innerHTML =
      `<div class="jc-top"><span class="jc-kind">${KIND_LABEL[e.kind] || "随笔"}</span>
       ${e.mood ? `<span class="jc-mood">${esc(e.mood)}</span>` : ""}
       <span class="jc-date">${esc((e.created_at || "").slice(0, 16).replace("T", " "))}</span></div>` +
      para(e.content);
    renderMoods(e.mood || "");
    setJournalMode("view");
    $("journal-modal").hidden = false;
  } catch (err) { alert(err.message); }
}

$("journal-close").addEventListener("click", () => { $("journal-modal").hidden = true; });
$("journal-modal").addEventListener("click", (e) => {
  if (e.target === $("journal-modal")) $("journal-modal").hidden = true;
});
$("journal-edit").addEventListener("click", () => {
  $("journal-content").value = journalState.raw || "";
  journalState.mode = "edit";
  setJournalMode("edit");
});
$("journal-save").addEventListener("click", async () => {
  const content = $("journal-content").value.trim();
  const errBox = $("journal-error");
  if (!content) { errBox.textContent = "日记内容不能为空。"; errBox.hidden = false; return; }
  errBox.hidden = true;
  const btn = $("journal-save");
  btn.disabled = true;
  try {
    const payload = {
      userId: uid(),
      title: $("journal-title").value.trim(),
      content,
      mood: journalState.mood,
      kind: (journalState.link && journalState.link.kind) || "note",
      refId: (journalState.link && journalState.link.refId) || null,
    };
    if (journalState.mode === "edit" && journalState.id) {
      await api(`/api/journal/${journalState.id}`, { method: "PUT", body: payload });
    } else {
      await api("/api/journal", { method: "POST", body: payload });
    }
    $("journal-modal").hidden = true;
    if (!$("view-journal").hidden) loadJournal();
  } catch (err) {
    errBox.textContent = err.message; errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
});
$("journal-delete").addEventListener("click", async () => {
  if (!journalState.id || !confirm("确定删除这篇日记吗？")) return;
  try {
    await api(`/api/journal/${journalState.id}?userId=${encodeURIComponent(uid())}`, { method: "DELETE" });
    $("journal-modal").hidden = true;
    loadJournal();
  } catch (err) { alert(err.message); }
});

/* "记到日记" from a tarot reading: app.js shows #share-reading when a
   reading completes — mirror its visibility, no app.js changes needed. */
new MutationObserver(() => {
  $("journal-from-tarot").hidden = $("share-reading").hidden;
}).observe($("share-reading"), { attributes: true, attributeFilter: ["hidden"] });
$("journal-from-tarot").addEventListener("click", () => {
  const q = ($("question") && $("question").value.trim()) || "";
  openJournalEditor({
    mode: "new",
    link: { kind: "tarot", refId: null, label: "塔罗占卜" },
    content: q ? `问题：${q}\n\n` : "",
  });
});

})();
