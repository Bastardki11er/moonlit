/* 会员权益前端冒烟测试：验证新 UI 逻辑不报错、文案正确。
   跑法：node tools/member-frontend-test.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name); }
}

const html = fs.readFileSync(path.join(__dirname, "..", "frontend", "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://moontarot.tech/", runScripts: "dangerously" });
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.Event = window.Event;
// navigator 在 Node 24 是只读 getter，jsdom 的 window.navigator 已可用，不覆盖

// fetch stub：按 URL 返回固定数据
const calls = [];
window.fetch = async (url, opts) => {
  calls.push({ url, opts });
  const base = String(url).split("?")[0];
  const method = (opts && opts.method) || "GET";
  const json = async () => {
    if (base === "/api/profile/birth" && method === "GET") {
      return { profile: { gender: "female", birth_year: 1998, birth_month: 5, birth_day: 20, birth_hour: 14, birth_minute: 30, calendar_type: "solar", is_leap_month: 0, latitude: 31.23, longitude: 121.47, birth_place: "上海" } };
    }
    if (base === "/api/profile/birth") return { ok: true };
    if (base === "/api/checkin/status") return { streak: 6, checkedInToday: false };
    if (base === "/api/checkin") return { ok: true, duplicate: false, streak: 7, rewardGranted: true, rewardAmount: 2, bonus: 5 };
    if (base === "/api/share-status") return { bonus: 3, grantsLeft: 2 };
    if (base === "/api/share-grant") return { ok: true, bonus: 4, grantsLeft: 1 };
    return {};
  };
  return { ok: true, json };
};
global.fetch = window.fetch;

async function main() {
  // 登录态：会员
  window.localStorage.setItem("moonlit_token", "tok123");
  window.localStorage.setItem("moonlit_uid", "uid-1");
  window.__moonlitMember = true;

  // 按真实顺序加载：用 <script> 标签注入，和浏览器行为一致（全局 const 跨脚本共享）
  const load = (f) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "js", f), "utf8");
    const s = window.document.createElement("script");
    s.textContent = src;
    window.document.head.appendChild(s);
  };
  load("cards.js");
  load("card-names-zh.js");
  load("growth.js");
  load("app.js");
  load("divination.js");

  // DOMContentLoaded 触发 growth/divination 的初始化
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  console.log("== 出生信息记忆 ==");
  const bar = window.document.getElementById("bazi-memory-bar");
  ok(!!bar && !bar.hidden, "八字表单出现出生记忆条");
  ok(bar && bar.textContent.includes("一键填入"), "记忆条有一键填入按钮");
  const fillBtn = window.document.getElementById("bazi-fill-profile");
  ok(!!fillBtn, "一键填入按钮存在");
  fillBtn.click();
  ok(window.document.getElementById("bazi-year").value === "1998", "一键填入：年份");
  ok(window.document.getElementById("bazi-month").value === "5", "一键填入：月份");
  ok(window.document.getElementById("bazi-day").value === "20", "一键填入：日期");
  ok(window.document.getElementById("bazi-hour").value === "14", "一键填入：时辰");
  ok(window.document.querySelector('input[name="bazi-gender"][value="female"]').checked, "一键填入：性别女");
  const remember = window.document.getElementById("bazi-remember");
  ok(!!remember && remember.checked, "记住复选框默认勾选");

  console.log("== 签到（会员 +2 文案） ==");
  const dots = window.document.getElementById("checkin-dots");
  ok(!!dots && dots.title.includes("+2"), "签到进度 title 显示 +2（会员）: " + (dots && dots.title));
  window.document.getElementById("checkin-btn").click();
  await new Promise((r) => setTimeout(r, 300));
  const toast = window.document.getElementById("moonlit-toast");
  ok(!!toast && toast.textContent.includes("+2"), "签到成功 toast 显示 +2: " + (toast && toast.textContent));

  console.log("== 分享区（会员文案） ==");
  const statusLine = window.document.getElementById("share-status-line");
  await new Promise((r) => setTimeout(r, 300));
  ok(!!statusLine && statusLine.innerHTML.includes("每天可领 3 次"), "分享区提示会员每天 3 次");

  console.log("== 受邀 toast（+2） ==");
  window.__onReferralApplied(2);
  await new Promise((r) => setTimeout(r, 1400));
  ok(toast.textContent.includes("+2"), "受邀 toast 显示 +2: " + toast.textContent);

  console.log("== 游客态 ==");
  window.localStorage.removeItem("moonlit_token");
  window.__moonlitMember = false;
  window.__refreshBirthMemory();
  await new Promise((r) => setTimeout(r, 300));
  const bar2 = window.document.getElementById("ziwei-memory-bar");
  ok(!!bar2 && !bar2.hidden && bar2.textContent.includes("登录后"), "游客看到登录提示");
  ok(!window.document.getElementById("ziwei-remember"), "游客没有记住复选框");

  console.log("== 追问提示（会员首免） ==");
  window.__moonlitMember = true;
  window.__followupFree = true;
  window.paintFollowupHint();
  const fuh = window.document.getElementById("followup-hint");
  ok(!!fuh && fuh.textContent.includes("首次追问免费"), "会员首免时追问提示显示免费: " + (fuh && fuh.textContent));
  window.__followupFree = false;
  window.paintFollowupHint();
  ok(fuh.textContent.includes("消耗 1 次"), "用过首免后提示切回普通");
  window.__moonlitMember = false;
  window.__followupFree = true;
  window.paintFollowupHint();
  ok(fuh.textContent.includes("消耗 1 次"), "游客即使 followupFree 也显示普通（字段只对会员为 true）");

  console.log("== 弹窗权益 HTML ==");
  const loggedView = window.document.getElementById("auth-logged-view");
  ok(!!loggedView && loggedView.innerHTML.includes("会员权益"), "已登录视图有会员权益区");
  ok(loggedView.innerHTML.includes("每天首次追问免费"), "权益含追问免费");
  ok(loggedView.innerHTML.includes("100 条"), "权益含 100 条历史");
  const formView = window.document.getElementById("auth-form-view");
  ok(formView.innerHTML.includes("会员权益"), "登录表单有注册 teaser");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
