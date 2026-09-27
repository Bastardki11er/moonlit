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
    setTimeout(() => toast(`🎉 受邀成功！你和朋友各得 +${n} 次免费解读`), 1200);
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
      box.innerHTML = '<p class="hint">黄历加载失败，刷新试试。</p>';
    }
  }

  function renderAlmanac(box, a) {
    const d = new Date(a.date + "T12:00:00");
    const md = (d.getMonth() + 1) + "月" + d.getDate() + "日";
    const wd = "星期" + WEEKDAYS[d.getDay()];
    const yi = (a.suitable || []).map((x) => `<span class="hl-chip yi">${esc(x)}</span>`).join("");
    const ji = (a.avoid || []).map((x) => `<span class="hl-chip ji">${esc(x)}</span>`).join("");
    const hours = (a.hours || []).map((h, i) => {
      const good = h.luck === "吉";
      return `<span class="hl-hour ${good ? "good" : "bad"}" title="${esc(h.ganZhi)}${h.god}">${SHICHEN[i]}时<small>${SHICHEN_TIME[i]}</small><b>${good ? "吉" : "凶"}</b></span>`;
    }).join("");
    box.innerHTML = `
      <div class="hl-head">
        <div class="hl-date"><b>${esc(md)}</b> ${esc(wd)}</div>
        <div class="hl-lunar">农历${esc(a.lunar.replace(/^.*年/, ""))} · ${esc(a.ganzhi)}日 · ${esc(a.zodiac)}年</div>
      </div>
      <div class="hl-row"><span class="hl-label">宜</span><div class="hl-chips">${yi || '<span class="hint">—</span>'}</div></div>
      <div class="hl-row"><span class="hl-label">忌</span><div class="hl-chips">${ji || '<span class="hint">—</span>'}</div></div>
      <div class="hl-meta">
        <span>⚡ 冲煞：${esc(a.chongSha || "—")}</span>
        <span>💰 财神：${esc((a.directions && a.directions.caiShen) || "—")}</span>
        <span>😊 喜神：${esc((a.directions && a.directions.xiShen) || "—")}</span>
      </div>
      <details class="hl-more">
        <summary>时辰吉凶 · 彭祖百忌</summary>
        <div class="hl-hours">${hours}</div>
        <p class="hint">彭祖百忌：${esc(a.pengZu || "—")}</p>
        <p class="hint">胎神：${esc(a.taiShen || "—")} · 值日：${esc(a.dayOfficer)}（${esc(a.tianShen)}${esc(a.tianShenLuck)}）</p>
      </details>
      <p class="hl-foot">传统民俗，仅供娱乐 🌙</p>`;
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
  const LUCKY_COLORS = ["蜜桃粉", "月光白", "星空蓝", "曜石黑", "香槟金", "薄荷绿",
    "樱桃红", "薰衣草紫", "奶油黄", "雾霾灰", "珊瑚橙", "青瓷绿"];
  const FORTUNE_LINES = {
    综合: ["整体节奏偏顺，适合把拖延的事推进一下。", "今天的直觉很准，跟着感觉走不容易错。", "宜稳不宜急，守住节奏就是赢。", "会有小确幸找上门，记得抬头看看。", "适合复盘和整理，为明天蓄力。", "别被琐事带跑，抓住一件重要的事就好。"],
    爱情: ["适合主动一点，TA 在等你的信号。", "单身者今天桃花藏在朋友的朋友里。", "有伴者适合一次走心的聊天，别只聊琐事。", "先把自己照顾好，爱情会跟着来。", "旧人旧事别回头，向前看更甜。", "一个小小的关心，比一百句情话管用。"],
    事业: ["适合推进卡了很久的那件事。", "会议上大胆说出想法，会被看见。", "贵人运在线，别不好意思求助。", "细节决定成败，今天多检查一遍。", "适合学习新技能，吸收特别快。", "保持耐心，大项目正在悄悄成形。"],
    财运: ["正财运稳，偏财别贪心。", "适合整理账单，会发现省钱空间。", "小额尝试可以，大手笔再等等。", "今天适合谈加薪或接副业线索。", "冲动消费预警，购物车先冷静一晚。", "朋友带来的消息里藏着机会。"],
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
      k, n: score(), line: pick(FORTUNE_LINES[k]),
    }));
    return {
      dims,
      color: pick(LUCKY_COLORS),
      number: 1 + Math.floor(rng() * 99),
      mate: mate.name,
    };
  }

  function initHoroscope() {
    const grid = $("horo-grid"), detail = $("horo-detail");
    if (!grid || !detail) return;
    const dateStr = beijingDateStr();
    const saved = localStorage.getItem("moonlit_sign");
    let current = (SIGNS.some((s) => s.name === saved) && saved) || SIGNS[0].name;

    grid.innerHTML = SIGNS.map((s) =>
      `<button class="horo-sign${s.name === current ? " active" : ""}" data-sign="${s.name}">
         <span class="horo-icon">${s.icon}</span><span>${s.name}</span>
       </button>`).join("");
    const render = (name) => {
      current = name;
      localStorage.setItem("moonlit_sign", name);
      grid.querySelectorAll(".horo-sign").forEach((b) =>
        b.classList.toggle("active", b.dataset.sign === name));
      const f = horoscopeFor(name, dateStr);
      const sign = SIGNS.find((s) => s.name === name);
      detail.innerHTML = `
        <div class="horo-title">${sign.icon} ${esc(name)} <span class="hint">${sign.dates}</span></div>
        ${f.dims.map((d) => `
          <div class="horo-dim">
            <div class="horo-dim-head"><span>${d.k}</span><span class="horo-stars">${stars(d.n)}</span></div>
            <p>${esc(d.line)}</p>
          </div>`).join("")}
        <div class="horo-lucky">
          <span>🎨 幸运色：<b>${esc(f.color)}</b></span>
          <span>🔢 幸运数字：<b>${f.number}</b></span>
          <span>💞 速配：<b>${esc(f.mate)}</b></span>
        </div>
        <p class="hl-foot">每天更新，仅供娱乐 🌙</p>`;
    };
    grid.addEventListener("click", (e) => {
      const b = e.target.closest(".horo-sign");
      if (b) render(b.dataset.sign);
    });
    render(current);
  }

  /* ============================================================
     3. 每日签到
     ============================================================ */
  async function initCheckin() {
    const btn = $("checkin-btn"), info = $("checkin-info"), dots = $("checkin-dots");
    if (!btn) return;
    const paint = (streak, checkedIn) => {
      const toGo = 7 - (streak % 7 || (checkedIn ? 7 : 0));
      const filled = streak % 7;
      // 注册用户签到满 7 天奖 +2，游客 +1
      const rewardN = (typeof window.__moonlitMember !== "undefined" && window.__moonlitMember) ? 2 : 1;
      info.textContent = checkedIn
        ? `已连续签到 ${streak} 天 🎉`
        : (streak > 0 ? `已连续签到 ${streak} 天，今日还未签到` : "今日还未签到");
      dots.innerHTML = Array.from({ length: 7 }, (_, i) =>
        `<span class="ck-dot${i < filled ? " on" : ""}${i === 6 ? " gift" : ""}"></span>`).join("");
      dots.title = `再签到 ${toGo} 天得 +${rewardN} 次免费解读`;
      btn.disabled = checkedIn;
      btn.textContent = checkedIn ? "✅ 今日已签到" : "📅 每日签到";
    };
    try {
      const s = await (await authedFetch("/api/checkin/status")).json();
      paint(s.streak || 0, !!s.checkedInToday);
    } catch (e) { /* 离线时保持默认 */ }
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const r = await (await authedFetch("/api/checkin", { method: "POST" })).json();
        paint(r.streak || 0, true);
        if (r.rewardGranted) toast(`🎉 连续签到 7 天！+${r.rewardAmount || 1} 次免费解读已到账`);
        else if (!r.duplicate) toast(`签到成功！已连续 ${r.streak} 天`);
      } catch (e) {
        toast("签到失败，稍后再试");
        btn.disabled = false;
      }
    });
  }

  /* ============================================================
     4. 分享赚次数 + 邀请链接
     ============================================================ */
  async function initShareEarn() {
    const box = $("share-earn");
    if (!box) return;
    const statusEl = $("share-status-line");
    const paint = async () => {
      try {
        const s = await (await authedFetch("/api/share-status")).json();
        const isMember = (typeof window.__moonlitMember !== "undefined" && window.__moonlitMember);
        statusEl.innerHTML =
          `🎟 我的奖励次数：<b>${s.bonus || 0}</b> · 今日还可领取：<b>${s.grantsLeft || 0}</b> 次` +
          `<br><span class="hint">奖励在免费额度用完后自动抵扣，不会过期` +
          (isMember ? " · 👑 会员每天可领 3 次" : " · 注册登录后每天可领 3 次 👑") + `</span>`;
        return s;
      } catch (e) { return null; }
    };
    await paint();

    const grantOnce = async () => {
      try {
        const r = await (await authedFetch("/api/share-grant", { method: "POST" })).json();
        await paint();
        if (r.ok) toast("🎉 +1 次免费解读已到账");
        else toast("今日领取次数已用完，明天再来");
      } catch (e) { toast("领取失败，稍后再试"); }
    };

    $("share-btn").addEventListener("click", async () => {
      const uid = (typeof moonlitUserId !== "undefined" && moonlitUserId)
        || localStorage.getItem("moonlit_uid") || "";
      const link = location.origin + "/?ref=" + uid;
      const data = { title: "月光塔罗", text: "来月光塔罗抽一张牌，看看今晚的月光想告诉你什么 🌙", url: link };
      if (navigator.share) {
        try { await navigator.share(data); grantOnce(); }
        catch (e) { /* 用户取消分享，不打扰 */ }
      } else {
        try {
          await navigator.clipboard.writeText(data.text + " " + link);
          toast("链接已复制，发给朋友吧");
          grantOnce();
        } catch (e) { toast("复制失败，长按复制链接"); }
      }
    });

    $("copy-invite-btn").addEventListener("click", async () => {
      const uid = (typeof moonlitUserId !== "undefined" && moonlitUserId)
        || localStorage.getItem("moonlit_uid") || "";
      const link = location.origin + "/?ref=" + uid;
      $("invite-link-text").textContent = link;
      try {
        await navigator.clipboard.writeText(link);
        toast("邀请链接已复制 📋");
      } catch (e) { toast("复制失败，请手动复制下方链接"); }
    });
  }

  /* ============================================================
     5. 新手引导：第一次来，问一句"想为什么而来"
     ============================================================ */
  const ONBOARD_INTENTS = [
    { icon: "💕", label: "感情桃花", q: "我最近的感情运势如何？" },
    { icon: "💼", label: "事业工作", q: "我接下来的事业运怎么样？" },
    { icon: "💰", label: "财运", q: "我近期的财运如何？" },
    { icon: "📚", label: "学业考试", q: "我最近的学业/考试运怎么样？" },
    { icon: "🪐", label: "看看命盘", view: "bazi" },
    { icon: "👀", label: "随便逛逛", view: null },
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
        <h3>今晚，想为什么而来？</h3>
        <p class="hint">选一个，月光带你直达</p>
        <div class="onboard-grid">
          ${ONBOARD_INTENTS.map((o, i) =>
            `<button class="onboard-opt" data-i="${i}"><span>${o.icon}</span>${o.label}</button>`).join("")}
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
      } else if (o.q) {
        const q = $("question");
        if (q && !q.value) q.value = o.q;
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
