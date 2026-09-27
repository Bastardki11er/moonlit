/* Member perks frontend smoke test: verifies the new UI logic runs without errors and the copy is right.
   Run: node tools/member-frontend-test.js */
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
// navigator is a read-only getter in Node 24; jsdom's window.navigator already works, don't override

// fetch stub: returns canned data per URL
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
  // start as guest (no token, member flag false)
  try { window.localStorage.removeItem("moonlit_token"); } catch (e) {}
  window.__moonlitMember = false;

  // load in real order: inject via <script> tags, same as browser behavior (global const shared across scripts)
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

  // DOMContentLoaded triggers growth/divination init
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  console.log("== guest mode: check-in/share login prompts ==");
  const cbtn = window.document.getElementById("checkin-btn");
  ok(!!cbtn && cbtn.textContent.includes("登录后签到"), "guest check-in button shows '登录后签到': " + (cbtn && cbtn.textContent));
  let modalOpened = false;
  const origOpen = window.__openAuthModal;
  window.__openAuthModal = () => { modalOpened = true; };
  cbtn.click();
  await new Promise((r) => setTimeout(r, 150));
  const toastG = window.document.getElementById("moonlit-toast");
  ok(modalOpened, "guest clicks check-in → login modal opens");
  ok(!!toastG && toastG.textContent.includes("登录后签到"), "guest clicks check-in → toast prompt: " + (toastG && toastG.textContent));
  window.__openAuthModal = origOpen;
  const statusLine = window.document.getElementById("share-status-line");
  ok(!!statusLine && statusLine.innerHTML.includes("登录后分享赚次数"), "guest share section prompts login");
  const descGuest = window.document.getElementById("share-earn-desc");
  ok(!!descGuest && descGuest.innerHTML.includes("各得 +1 次") && descGuest.innerHTML.includes("登录后"),
    "guest share copy: +1 and hints at more after login");
  const barGuest = window.document.getElementById("ziwei-memory-bar");
  ok(!!barGuest && !barGuest.hidden && barGuest.textContent.includes("登录后"), "guest sees login prompt on chart page");
  ok(!window.document.getElementById("ziwei-remember"), "guest has no remember checkbox");

  console.log("== switch to member ==");
  window.localStorage.setItem("moonlit_token", "tok123");
  window.localStorage.setItem("moonlit_uid", "uid-1");
  window.__moonlitMember = true;
  await window.__refreshGrowth();
  window.__refreshBirthMemory();
  await new Promise((r) => setTimeout(r, 300));

  console.log("== birth profile memory ==");
  const bar = window.document.getElementById("bazi-memory-bar");
  ok(!!bar && !bar.hidden, "bazi form shows birth-memory bar");
  ok(bar && bar.textContent.includes("一键填入"), "memory bar has one-tap fill button");
  const fillBtn = window.document.getElementById("bazi-fill-profile");
  ok(!!fillBtn, "one-tap fill button exists");
  fillBtn.click();
  ok(window.document.getElementById("bazi-year").value === "1998", "one-tap fill: year");
  ok(window.document.getElementById("bazi-month").value === "5", "one-tap fill: month");
  ok(window.document.getElementById("bazi-day").value === "20", "one-tap fill: day");
  ok(window.document.getElementById("bazi-hour").value === "14", "one-tap fill: hour");
  ok(window.document.querySelector('input[name="bazi-gender"][value="female"]').checked, "one-tap fill: gender female");
  const remember = window.document.getElementById("bazi-remember");
  ok(!!remember && remember.checked, "remember checkbox checked by default");

  console.log("== check-in (member +2 copy) ==");
  const dots = window.document.getElementById("checkin-dots");
  ok(!!dots && dots.title.includes("+2"), "check-in progress title shows +2 (member): " + (dots && dots.title));
  window.document.getElementById("checkin-btn").click();
  await new Promise((r) => setTimeout(r, 300));
  const toast = window.document.getElementById("moonlit-toast");
  ok(!!toast && toast.textContent.includes("+2"), "check-in success toast shows +2: " + (toast && toast.textContent));

  console.log("== share section (member copy) ==");
  await new Promise((r) => setTimeout(r, 300));
  ok(!!statusLine && statusLine.innerHTML.includes("每天可领 3 次"), "share section says members get 3/day");
  const descMember = window.document.getElementById("share-earn-desc");
  ok(!!descMember && descMember.innerHTML.includes("各得 +2 次"), "member share copy: +2 each per invite");

  console.log("== referred toast (+2) ==");
  window.__onReferralApplied(2);
  await new Promise((r) => setTimeout(r, 1400));
  ok(toast.textContent.includes("+2"), "referred toast shows +2: " + toast.textContent);

  console.log("== follow-up hint (member first-free) ==");
  window.__moonlitMember = true;
  window.__followupFree = true;
  window.paintFollowupHint();
  const fuh = window.document.getElementById("followup-hint");
  ok(!!fuh && fuh.textContent.includes("首次追问免费"), "follow-up hint shows free for member first-free: " + (fuh && fuh.textContent));
  window.__followupFree = false;
  window.paintFollowupHint();
  ok(fuh.textContent.includes("消耗 1 次"), "hint reverts to normal after first-free used");
  window.__moonlitMember = false;
  window.__followupFree = true;
  window.paintFollowupHint();
  ok(fuh.textContent.includes("消耗 1 次"), "guests still see the normal hint even when followupFree (field is only true for members)");

  console.log("== modal perks HTML ==");
  const loggedView = window.document.getElementById("auth-logged-view");
  ok(!!loggedView && loggedView.innerHTML.includes("会员权益"), "logged-in view has member perks section");
  ok(loggedView.innerHTML.includes("每天首次追问免费"), "perks include free follow-ups");
  ok(loggedView.innerHTML.includes("100 条"), "perks include 100-entry history");
  const formView = window.document.getElementById("auth-form-view");
  ok(formView.innerHTML.includes("会员权益"), "login form has signup teaser");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
