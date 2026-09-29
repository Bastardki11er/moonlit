/* Smoke test for: gallery as its own view + reveal-mode picker (auto vs manual).
   Run: node tools/reveal-gallery-test.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL: " + name); } }

(async () => {
const html = fs.readFileSync(path.join(__dirname, "..", "frontend", "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://moontarot.tech/", runScripts: "dangerously" });
const { window } = dom;
window.HTMLElement.prototype.scrollIntoView = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
// jsdom lacks the Web Animations API; stub it so sparkBurst doesn't throw
window.HTMLElement.prototype.animate = () => ({ onfinish: null, finished: Promise.resolve() });
window.fetch = async () => ({ ok: true, json: async () => ({}) });
const load = (f) => {
  const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "js", f), "utf8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.head.appendChild(s);
};
load("i18n.js"); load("i18n-dict.js");
load("cards.js"); load("card-names-zh.js"); load("growth.js"); load("app.js"); load("divination.js");
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));

const $ = (id) => window.document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. gallery is its own view ----
ok($("view-gallery") && $("view-gallery").hidden, "view-gallery exists and starts hidden");
ok(!$("view-tarot").querySelector("#gallery-grid"), "gallery removed from the tarot view");
window.document.querySelector('.feature-tile[data-goto="gallery"]').click();
await sleep(50);
ok(!$("view-gallery").hidden && $("view-tarot").hidden, "homepage 牌鉴 tile opens the gallery view");
ok($("gallery-grid").children.length > 0, "gallery grid renders 78 cards in its own view");
window.document.querySelector('#topnav [data-view="tarot"]').click(); // back to tarot (switchView is IIFE-private)
await sleep(50);
window.document.querySelectorAll('[data-goto="gallery"]')[1].click(); // toolbar button
await sleep(50);
ok(!$("view-gallery").hidden, "tarot toolbar 牌鉴 button opens the gallery view");

// ---- 2. reveal mode picker exists ----
window.document.querySelector('#topnav [data-view="tarot"]').click();
await sleep(50);
const radios = [...window.document.querySelectorAll('input[name="reveal-mode"]')];
ok(radios.length === 2 && radios.map(r => r.value).join(",") === "auto,manual", "reveal-mode picker has auto + manual");
ok(radios[0].checked, "auto is the default");

// ---- 3. manual mode: cards stay face-down until tapped ----
radios[1].click();
ok(window.eval("revealMode") === "manual", "switching to manual updates revealMode");
$("question").value = "手动翻牌测试";
window.document.querySelector('.spread-btn[data-spread="love"]').click();
await sleep(1200); // shuffle ritual
for (let i = 0; i < 5; i++) $("deck").click();
await sleep(1500); // past the auto-flip stagger window
let cards = [...window.document.querySelectorAll("#drawn .tarot-card")];
ok(cards.length === 5, "5 cards drawn in manual mode");
ok(cards.every(c => !c.classList.contains("revealed")), "manual: no card auto-flips");
ok($("step-reading").hidden, "manual: reading step waits until all cards are flipped");
ok($("draw-hint").textContent.includes("逐张"), "manual: hint tells user to flip each card");
for (const c of cards) { c.click(); await sleep(60); }
await sleep(1200);
ok(cards.every(c => c.classList.contains("revealed")), "manual: tapping flips every card");
ok(!$("step-reading").hidden, "manual: reading step appears after the last card is flipped");

// ---- 4. auto mode still works as before ----
$("restart").click();
await sleep(100);
radios[0].click();
$("question").value = "自动揭晓测试";
window.document.querySelector('.spread-btn[data-spread="single"]').click();
await sleep(1200);
$("deck").click();
await sleep(2500); // auto-flip stagger + 900ms advance
ok(!$("step-reading").hidden, "auto: reading step appears on its own");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e.message); process.exit(1); });
