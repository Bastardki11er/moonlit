/* Language-toggle integration test: clicks the header toggle in a real DOM
   and verifies static labels + dynamic content switch languages.
   Run: node tools/i18n-toggle-test.js */
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
window.fetch = async () => ({ ok: true, json: async () => ({}) });
const load = (f) => {
  const src = fs.readFileSync(path.join(__dirname, "..", "frontend", "js", f), "utf8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.head.appendChild(s);
};
for (const f of ["i18n.js", "i18n-dict.js", "cards.js", "card-names-zh.js", "growth.js", "app.js", "divination.js"]) load(f);
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));

const $ = (id) => window.document.getElementById(id);
const txt = (id) => ($(id) || {}).textContent || "";

// 1. default is Chinese
ok(window.localStorage.getItem("moonlit_lang") === null || window.localStorage.getItem("moonlit_lang") === "zh", "default language is zh");
ok($("lang-toggle").textContent === "EN", "toggle shows EN while in zh mode");
ok(txt("daily-title").includes("每日") || document_is_zh(), "static label in Chinese by default");

// 2. click toggle -> English
$("lang-toggle").click();
await new Promise((r) => setTimeout(r, 100));
ok(window.localStorage.getItem("moonlit_lang") === "en", "choice persisted to localStorage");
ok($("lang-toggle").textContent === "中文", "toggle shows 中文 while in en mode");
ok(window.document.documentElement.getAttribute("lang") === "en", "<html lang> updated");

// static labels switched
const step2 = window.document.querySelector('[data-i18n="html.tarot.step2"]');
ok(step2 && /Choose/i.test(step2.textContent), "static data-i18n label switched to English: " + (step2 && step2.textContent.trim()));

// spread button names switched
const loveBtn = window.document.querySelector('[data-spread="love"] .spread-name');
ok(loveBtn && /Love/i.test(loveBtn.textContent), "spread button in English: " + (loveBtn && loveBtn.textContent.trim()));

// dynamic: daily card re-rendered in English
ok(/The |[A-Z]/.test(txt("daily-name")) && !/[\u4e00-\u9fff]/.test(txt("daily-name")), "daily card name in English: " + txt("daily-name").trim());

// dynamic: gallery re-rendered in English
const gname = window.document.querySelector(".gallery-name");
ok(gname && !/[\u4e00-\u9fff]/.test(gname.textContent), "gallery name in English: " + (gname && gname.textContent.trim()));

// 3. click again -> back to Chinese
$("lang-toggle").click();
await new Promise((r) => setTimeout(r, 100));
ok(window.localStorage.getItem("moonlit_lang") === "zh", "toggled back to zh");
ok(/[\u4e00-\u9fff]/.test(txt("daily-name")), "daily card name back in Chinese: " + txt("daily-name").trim());
const loveBtn2 = window.document.querySelector('[data-spread="love"] .spread-name');
ok(loveBtn2 && /感情/.test(loveBtn2.textContent), "spread button back in Chinese");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

function document_is_zh() {
  const el = window.document.querySelector('[data-i18n="html.tarot.step2"]');
  return el && /[\u4e00-\u9fff]/.test(el.textContent);
}
})();
