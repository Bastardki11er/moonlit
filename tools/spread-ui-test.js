/* Topic-spread frontend smoke test: buttons / card positions / spread name sent to backend.
   Run: node tools/spread-ui-test.js */
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
load("i18n.js"); load("i18n-dict.js");
load("cards.js"); load("card-names-zh.js"); load("growth.js"); load("app.js");
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));

const $ = (id) => window.document.getElementById(id);
const btns = [...window.document.querySelectorAll(".spread-btn")];
ok(btns.length === 5, "5 topic-spread buttons");
ok(btns.map(b => b.dataset.spread).join(",") === "single,love,career,fortune,celtic", "data-spread keys correct");
ok([...window.document.querySelectorAll("h2")].some(h => h.textContent.includes("主题牌阵")), "heading is the topic-spread picker");

const byKey = (k) => btns.find(b => b.dataset.spread === k);
const drawAll = (n) => { for (let i = 0; i < n; i++) $("deck").click(); };
const reset = () => $("restart").click();
const expectations = {
  love:    { count: "5 张牌", n: 5, positions: "你的状态|对方的状态|关系现状|阻碍|未来发展" },
  career:  { count: "5 张牌", n: 5, positions: "事业现状|你的优势|当前挑战|潜在机遇|未来趋势" },
  fortune: { count: "5 张牌", n: 5, positions: "财务现状|收入机会|支出风险|理财建议|未来趋势" },
  celtic:  { count: "10 张牌", n: 10, positions: null },
  single:  { count: "1 张牌", n: 1, positions: null },
};
for (const [key, exp] of Object.entries(expectations)) {
  $("question").value = "测试问题";
  byKey(key).click();
  ok($("draw-count").textContent === exp.count, `${key} shows ${exp.count}`);
  drawAll(exp.n);
  await new Promise((r) => setTimeout(r, 100));
  const got = window.eval("state.drawn.map(c => c.position).join('|')");
  if (exp.positions) ok(got === exp.positions, `${key} positions correct`);
  else ok(window.eval("state.drawn.length") === exp.n, `${key} drew ${exp.n} cards`);
  reset();
}

// the spread name sent to backend should be the emoji-prefixed Chinese name
let sentBody = null;
window.fetch = async (url, opts) => {
  if (String(url).includes("/api/reading")) sentBody = JSON.parse(opts.body);
  return { ok: true, json: async () => ({ ok: true, reading: { id: "r1" } }) };
};
$("question").value = "他还爱我吗？";
byKey("love").click();
drawAll(5);
await new Promise((r) => setTimeout(r, 1100)); // wait for showReadingStep
$("get-reading").click();
await new Promise((r) => setTimeout(r, 500));
ok(sentBody && sentBody.spread === "💕 感情牌阵", "spread name sent to backend correct: " + (sentBody && sentBody.spread));
ok(sentBody && sentBody.cards.length === 5 && sentBody.cards[0].position === "你的状态", "cards carry topic positions");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
