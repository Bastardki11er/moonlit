/* ============================================================
   Moonlit growth pack — 黄历 / 星座运势 / 每日签到 / 分享裂变 / 新手引导
   自包含模块：只读 app.js 的 moonlitUserId / authHeaders，不改动原有逻辑。
   注意：?ref= 的捕获在文件顶部同步执行（本文件在 app.js 之前引入），
   app.js 的 initUser 会把 localStorage 里的 moonlit_ref 一起发给后端。
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 0. 邀请链接 ?ref= 捕获（必须在 app.js 的 initUser 之前） ---------- */
  try {
    const params = new URLSearchParams(location.search);
    const ref = (params.get("ref") || "").trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
      const mine = localStorage.getItem("moonlit_uid");
      if (ref !== mine) localStorage.setItem("moonlit_ref", ref);
    }
  } catch (e) { /* ignore */ }

  /* ---------- 小工具 ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function toast(msg, ms) {
    let t = $("moonlit-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "moonlit-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), ms || 2600);
  }

  function authedFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { "Content-Type": "application/json" },
      (typeof authHeaders === "function" ? authHeaders() : {}),
      opts.headers || {}
    );
    const uid = (typeof moonlitUserId !== "undefined" && moonlitUserId)
      || localStorage.getItem("moonlit_uid");
    const u = url + (url.indexOf("?") >= 0 ? "&" : "?") + "userId=" + encodeURIComponent(uid || "");
    return fetch(u, opts);
  }

  function beijingDateStr(d) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(d || new Date());
    } catch (e) {
      return (d || new Date()).toISOString().slice(0, 10);
    }
  }

  /* 确定性随机：同一天全站同一星座看到同样的运势（和真星座网站一样） */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 受邀回调：app.js 的 initUser 在确认 referralApplied 后调用，reward 为双方各得的次数 */
  window.__onReferralApplied = function (reward) {
    try { localStorage.removeItem("moonlit_ref"); } catch (e) {}
    const n = reward || 1;
    setTimeout(() => toast(t("growth.referral.success", { n })), 1200);
  };

  /* 登录态变化后重绘增长区（app.js 的 setLoggedIn/setLoggedOut 会调用） */
  window.__refreshGrowth = async function () {
    if (typeof window.__refreshCheckin === "function") { try { await window.__refreshCheckin(); } catch (e) {} }
    if (typeof window.__refreshShareEarn === "function") { try { await window.__refreshShareEarn(); } catch (e) {} }
  };
  const isMember = () => (typeof window.__moonlitMember !== "undefined" && window.__moonlitMember);
  const needLogin = (msg) => {
    toast(msg);
    if (typeof window.__openAuthModal === "function") window.__openAuthModal();
  };

  document.addEventListener("DOMContentLoaded", () => {
    initAlmanac();
    initHoroscope();
    initCheckin();
    initShareEarn();
    initOnboarding();
  });

  /* ============================================================
     1. 今日黄历
     ============================================================ */
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const SHICHEN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const SHICHEN_TIME = ["23–1", "1–3", "3–5", "5–7", "7–9", "9–11", "11–13",
    "13–15", "15–17", "17–19", "19–21", "21–23"];

  async function initAlmanac() {
    const box = $("almanac-box");
    if (!box) return;
    try {
      const res = await fetch("/api/almanac");
      if (!res.ok) throw new Error("bad");
      const a = await res.json();
      renderAlmanac(box, a);
    } catch (e) {
      box.innerHTML = `<p class="hint">${t("growth.almanac.load_failed")}</p>`;
    }
  }

  function renderAlmanac(box, a) {
    const d = new Date(a.date + "T12:00:00");
    const md = t("growth.almanac.md", { m: d.getMonth() + 1, d: d.getDate() });
    const wd = t("growth.almanac.weekday", { w: (getLang() === "en" ? WEEKDAYS_EN : WEEKDAYS)[d.getDay()] });
    const yi = (a.suitable || []).map((x) => `<span class="hl-chip yi">${esc(x)}</span>`).join("");
    const ji = (a.avoid || []).map((x) => `<span class="hl-chip ji">${esc(x)}</span>`).join("");
    const hours = (a.hours || []).map((h, i) => {
      const good = h.luck === "吉";
      return `<span class="hl-hour ${good ? "good" : "bad"}" title="${esc(h.ganZhi)}${h.god}">${t("growth.almanac.shichen_label", { s: SHICHEN[i] })}<small>${SHICHEN_TIME[i]}</small><b>${good ? t("growth.almanac.lucky") : t("growth.almanac.unlucky")}</b></span>`;
    }).join("");
    box.innerHTML = `
      <div class="hl-head">
        <div class="hl-date"><b>${esc(md)}</b> ${esc(wd)}</div>
        <div class="hl-lunar">${t("growth.almanac.lunar", { lunar: esc(a.lunar.replace(/^.*年/, "")), ganzhi: esc(a.ganzhi), zodiac: esc(a.zodiac) })}</div>
      </div>
      <div class="hl-row"><span class="hl-label">${t("growth.almanac.yi")}</span><div class="hl-chips">${yi || '<span class="hint">—</span>'}</div></div>
      <div class="hl-row"><span class="hl-label">${t("growth.almanac.ji")}</span><div class="hl-chips">${ji || '<span class="hint">—</span>'}</div></div>
      <div class="hl-meta">
        <span>${t("growth.almanac.chongsha", { v: esc(a.chongSha || "—") })}</span>
        <span>${t("growth.almanac.caishen", { v: esc((a.directions && a.directions.caiShen) || "—") })}</span>
        <span>${t("growth.almanac.xishen", { v: esc((a.directions && a.directions.xiShen) || "—") })}</span>
      </div>
      <details class="hl-more">
        <summary>${t("growth.almanac.hours_title")}</summary>
        <div class="hl-hours">${hours}</div>
        <p class="hint">${t("growth.almanac.pengzu", { v: esc(a.pengZu || "—") })}</p>
        <p class="hint">${t("growth.almanac.taishen", { ts: esc(a.taiShen || "—"), off: esc(a.dayOfficer), shen: esc(a.tianShen), luck: esc(a.tianShenLuck) })}</p>
      </details>
      <p class="hl-foot">${t("growth.almanac.foot")}</p>`;
  }

  /* ============================================================
     2. 十二星座今日运势（全站同日同星座结果一致）
     ============================================================ */
  const SIGNS = [
    { name: "白羊座", icon: "♈", dates: "3.21–4.19" }, { name: "金牛座", icon: "♉", dates: "4.20–5.20" },
    { name: "双子座", icon: "♊", dates: "5.21–6.21" }, { name: "巨蟹座", icon: "♋", dates: "6.22–7.22" },
    { name: "狮子座", icon: "♌", dates: "7.23–8.22" }, { name: "处女座", icon: "♍", dates: "8.23–9.22" },
    { name: "天秤座", icon: "♎", dates: "9.23–10.23" }, { name: "天蝎座", icon: "♏", dates: "10.24–11.22" },
    { name: "射手座", icon: "♐", dates: "11.23–12.21" }, { name: "摩羯座", icon: "♑", dates: "12.22–1.19" },
    { name: "水瓶座", icon: "♒", dates: "1.20–2.18" }, { name: "双鱼座", icon: "♓", dates: "2.19–3.20" },
  ];
  // SIGN_KEYS[i] matches SIGNS[i]; zh names stay the storage/rng keys, display goes through t()
  const SIGN_KEYS = ["growth.horo.sign_aries", "growth.horo.sign_taurus", "growth.horo.sign_gemini",
    "growth.horo.sign_cancer", "growth.horo.sign_leo", "growth.horo.sign_virgo",
    "growth.horo.sign_libra", "growth.horo.sign_scorpio", "growth.horo.sign_sagittarius",
    "growth.horo.sign_capricorn", "growth.horo.sign_aquarius", "growth.horo.sign_pisces"];
  const signKey = (name) => SIGN_KEYS[SIGNS.findIndex((s) => s.name === name)];
  const LUCKY_COLORS = ["growth.horo.color_peach", "growth.horo.color_moonlight", "growth.horo.color_starry",
    "growth.horo.color_obsidian", "growth.horo.color_champagne", "growth.horo.color_mint",
    "growth.horo.color_cherry", "growth.horo.color_lavender", "growth.horo.color_cream",
    "growth.horo.color_haze", "growth.horo.color_coral", "growth.horo.color_celadon"];
  const DIM_KEYS = { "综合": "growth.horo.dim_overall", "爱情": "growth.horo.dim_love", "事业": "growth.horo.dim_career", "财运": "growth.horo.dim_wealth" };
  const FORTUNE_LINES = {
    "综合": ["growth.horo.f_overall_1", "growth.horo.f_overall_2", "growth.horo.f_overall_3", "growth.horo.f_overall_4", "growth.horo.f_overall_5", "growth.horo.f_overall_6"],
    "爱情": ["growth.horo.f_love_1", "growth.horo.f_love_2", "growth.horo.f_love_3", "growth.horo.f_love_4", "growth.horo.f_love_5", "growth.horo.f_love_6"],
    "事业": ["growth.horo.f_career_1", "growth.horo.f_career_2", "growth.horo.f_career_3", "growth.horo.f_career_4", "growth.horo.f_career_5", "growth.horo.f_career_6"],
    "财运": ["growth.horo.f_wealth_1", "growth.horo.f_wealth_2", "growth.horo.f_wealth_3", "growth.horo.f_wealth_4", "growth.horo.f_wealth_5", "growth.horo.f_wealth_6"],
  };
  function stars(n) {
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }
  function horoscopeFor(signName, dateStr) {
    const rng = mulberry32(fnv1a(dateStr + "|" + signName));
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const score = () => 3 + Math.floor(rng() * 3); // 3–5 星，偏正能量
    const idx = SIGNS.findIndex((s) => s.name === signName);
    let mate = SIGNS[Math.floor(rng() * 12)];
    if (mate.name === signName) mate = SIGNS[(idx + 5) % 12];
    const dims = ["综合", "爱情", "事业", "财运"].map((k) => ({
      k, n: score(), line: t(pick(FORTUNE_LINES[k])),
    }));
    return {
      dims,
      color: pick(LUCKY_COLORS),
      number: 1 + Math.floor(rng() * 99),
      mate: mate.name,
    };
  }

  let horoBound = false; // the grid click listener must only bind once
  function initHoroscope() {
    const grid = $("horo-grid"), detail = $("horo-detail");
    if (!grid || !detail) return;
    const dateStr = beijingDateStr();
    const saved = localStorage.getItem("moonlit_sign");
    let current = (SIGNS.some((s) => s.name === saved) && saved) || SIGNS[0].name;

    grid.innerHTML = SIGNS.map((s, i) =>
      `<button class="horo-sign${s.name === current ? " active" : ""}" data-sign="${s.name}">
         <span class="horo-icon">${s.icon}</span><span>${t(SIGN_KEYS[i])}</span>
       </button>`).join("");
    const render = (name) => {
      current = name;
      localStorage.setItem("moonlit_sign", name);
      grid.querySelectorAll(".horo-sign").forEach((b) =>
        b.classList.toggle("active", b.dataset.sign === name));
      const f = horoscopeFor(name, dateStr);
      const sign = SIGNS.find((s) => s.name === name);
      detail.innerHTML = `
        <div class="horo-title">${sign.icon} ${esc(t(signKey(name)))} <span class="hint">${sign.dates}</span></div>
        ${f.dims.map((d) => `
          <div class="horo-dim">
            <div class="horo-dim-head"><span>${t(DIM_KEYS[d.k])}</span><span class="horo-stars">${stars(d.n)}</span></div>
            <p>${esc(d.line)}</p>
          </div>`).join("")}
        <div class="horo-lucky">
          <span>${t("growth.horo.lucky_color", { v: esc(t(f.color)) })}</span>
          <span>${t("growth.horo.lucky_number", { n: f.number })}</span>
          <span>${t("growth.horo.mate", { v: esc(t(signKey(f.mate))) })}</span>
        </div>
        <p class="hl-foot">${t("growth.horo.foot")}</p>`;
    };
    if (!horoBound) {
      grid.addEventListener("click", (e) => {
        const b = e.target.closest(".horo-sign");
        if (b) render(b.dataset.sign);
      });
      horoBound = true;
    }
    render(current);
  }

  // Re-render language-dependent dynamic content when the user toggles languages.
  // (Static labels are handled by data-i18n; these two views render text via JS.)
  document.addEventListener("moonlit-lang-change", () => {
    try { initAlmanac(); } catch (e) { /* ignore */ }
    try { initHoroscope(); } catch (e) { /* ignore */ }
  });

  /* ============================================================
     3. 每日签到（注册用户专享：连续签到是回访福利）
     ============================================================ */
  async function initCheckin() {
    const btn = $("checkin-btn"), info = $("checkin-info"), dots = $("checkin-dots");
    if (!btn) return;
    const paint = (streak, checkedIn) => {
      const toGo = 7 - (streak % 7 || (checkedIn ? 7 : 0));
      const filled = streak % 7;
      info.textContent = checkedIn
        ? t("growth.checkin.streak_done", { n: streak })
        : (streak > 0 ? t("growth.checkin.streak_pending", { n: streak }) : t("growth.checkin.not_today"));
      dots.innerHTML = Array.from({ length: 7 }, (_, i) =>
        `<span class="ck-dot${i < filled ? " on" : ""}${i === 6 ? " gift" : ""}"></span>`).join("");
      dots.title = t("growth.checkin.dots_title", { n: toGo });
      btn.disabled = checkedIn;
      btn.textContent = checkedIn ? t("growth.checkin.done_btn") : t("growth.checkin.btn");
    };
    const paintGuest = () => {
      info.innerHTML = t("growth.checkin.guest_info");
      dots.innerHTML = Array.from({ length: 7 }, (_, i) =>
        `<span class="ck-dot${i === 6 ? " gift" : ""}"></span>`).join("");
      dots.title = t("growth.checkin.guest_dots");
      btn.disabled = false;
      btn.textContent = t("growth.checkin.guest_btn");
    };
    const refresh = async () => {
      if (!isMember()) { paintGuest(); return; }
      try {
        const s = await (await authedFetch("/api/checkin/status")).json();
        paint(s.streak || 0, !!s.checkedInToday);
      } catch (e) { /* 离线时保持默认 */ }
    };
    window.__refreshCheckin = refresh;
    await refresh();
    btn.addEventListener("click", async () => {
      if (!isMember()) {
        needLogin(t("growth.checkin.need_login"));
        return;
      }
      btn.disabled = true;
      try {
        const res = await authedFetch("/api/checkin", { method: "POST" });
        if (res.status === 401) {
          const d = await res.json().catch(() => ({}));
          needLogin(d.error || t("growth.checkin.login_required"));
          btn.disabled = false;
          await refresh();
          return;
        }
        const r = await res.json();
        paint(r.streak || 0, true);
        if (r.rewardGranted) toast(t("growth.checkin.reward_toast", { n: r.rewardAmount || 1 }));
        else if (!r.duplicate) toast(t("growth.checkin.success_toast", { n: r.streak }));
      } catch (e) {
        toast(t("growth.checkin.fail_toast"));
        btn.disabled = false;
      }
    });
  }

  /* ============================================================
     4. 分享赚次数 + 邀请链接（领取奖励需要登录；分享传播本身不拦）
     ============================================================ */
  async function initShareEarn() {
    const box = $("share-earn");
    if (!box) return;
    const statusEl = $("share-status-line");
    const descEl = $("share-earn-desc");
    const paintDesc = () => {
      if (!descEl) return;
      descEl.innerHTML = isMember()
        ? t("growth.share.desc_member")
        : t("growth.share.desc_guest");
    };
    const paint = async () => {
      paintDesc();
      if (!isMember()) {
        statusEl.innerHTML =
          t("growth.share.guest_status_main") +
          `<br><span class="hint">${t("growth.share.guest_status_hint")}</span>`;
        return null;
      }
      try {
        const s = await (await authedFetch("/api/share-status")).json();
        statusEl.innerHTML =
          t("growth.share.status_main", { bonus: s.bonus || 0, left: s.grantsLeft || 0 }) +
          `<br><span class="hint">${t("growth.share.status_hint")}</span>`;
        return s;
      } catch (e) { return null; }
    };
    window.__refreshShareEarn = paint;
    await paint();

    const grantOnce = async () => {
      try {
        const res = await authedFetch("/api/share-grant", { method: "POST" });
        if (res.status === 401) {
          const d = await res.json().catch(() => ({}));
          needLogin(d.error || t("growth.share.need_login"));
          return;
        }
        const r = await res.json();
        await paint();
        if (r.ok) toast(t("growth.share.granted_toast"));
        else toast(t("growth.share.exhausted_toast"));
      } catch (e) { toast(t("growth.share.fail_toast")); }
    };

    $("share-btn").addEventListener("click", async () => {
      const uid = (typeof moonlitUserId !== "undefined" && moonlitUserId)
        || localStorage.getItem("moonlit_uid") || "";
      const link = location.origin + "/?ref=" + uid;
      const data = { title: t("growth.share.share_title"), text: t("growth.share.share_text"), url: link };
      if (navigator.share) {
        try { await navigator.share(data); grantOnce(); }
        catch (e) { /* 用户取消分享，不打扰 */ }
      } else {
        try {
          await navigator.clipboard.writeText(data.text + " " + link);
          toast(t("growth.share.copied_toast"));
          grantOnce();
        } catch (e) { toast(t("growth.share.copy_fail_toast")); }
      }
    });

    $("copy-invite-btn").addEventListener("click", async () => {
      const uid = (typeof moonlitUserId !== "undefined" && moonlitUserId)
        || localStorage.getItem("moonlit_uid") || "";
      const link = location.origin + "/?ref=" + uid;
      $("invite-link-text").textContent = link;
      try {
        await navigator.clipboard.writeText(link);
        toast(t("growth.share.invite_copied"));
      } catch (e) { toast(t("growth.share.invite_copy_fail")); }
    });
  }

  /* ============================================================
     5. 新手引导：第一次来，问一句"想为什么而来"
     ============================================================ */
  const ONBOARD_INTENTS = [
    { icon: "💕", labelKey: "growth.onboard.intent_love", qKey: "growth.onboard.q_love" },
    { icon: "💼", labelKey: "growth.onboard.intent_career", qKey: "growth.onboard.q_career" },
    { icon: "💰", labelKey: "growth.onboard.intent_wealth", qKey: "growth.onboard.q_wealth" },
    { icon: "📚", labelKey: "growth.onboard.intent_study", qKey: "growth.onboard.q_study" },
    { icon: "🪐", labelKey: "growth.onboard.intent_chart", view: "bazi" },
    { icon: "👀", labelKey: "growth.onboard.intent_browse", view: null },
  ];
  function initOnboarding() {
    try {
      if (localStorage.getItem("moonlit_onboarded")) return;
    } catch (e) { return; }
    if (document.getElementById("onboard-overlay")) return; // 防重复初始化
    const ov = document.createElement("div");
    ov.id = "onboard-overlay";
    ov.innerHTML = `
      <div class="onboard-card">
        <div class="onboard-moon">🌙</div>
        <h3>${t("growth.onboard.title")}</h3>
        <p class="hint">${t("growth.onboard.sub")}</p>
        <div class="onboard-grid">
          ${ONBOARD_INTENTS.map((o, i) =>
            `<button class="onboard-opt" data-i="${i}"><span>${o.icon}</span>${t(o.labelKey)}</button>`).join("")}
        </div>
      </div>`;
    document.body.appendChild(ov);
    const done = () => {
      try { localStorage.setItem("moonlit_onboarded", "1"); } catch (e) {}
      ov.remove();
    };
    ov.addEventListener("click", (e) => {
      const b = e.target.closest(".onboard-opt");
      if (!b) return;
      const o = ONBOARD_INTENTS[+b.dataset.i];
      done();
      if (o.view) {
        switchView(o.view);
      } else if (o.qKey) {
        const q = $("question");
        if (q && !q.value) q.value = t(o.qKey);
        switchView("tarot");
        setTimeout(() => { const t = $("step-question"); if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth" }); }, 80);
      }
      // "随便逛逛" → view: null，只关闭
    });
  }
  function switchView(name) {
    const btn = document.querySelector(`.topnav [data-view="${name}"]`);
    if (btn) btn.click();
    else {
      document.querySelectorAll(".view").forEach((v) => { v.hidden = true; });
      const v = $("view-" + name);
      if (v) v.hidden = false;
    }
  }
})();
