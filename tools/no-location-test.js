/* 去经纬度专项测试：确认站内不再收集/使用经纬度，星盘无上升点时照常渲染。
   跑法：node tools/no-location-test.js */
"use strict";
const fs = require("fs");
const { JSDOM } = require("jsdom");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name); }
}

// --- 源码层面：无经纬度残留 ---
const fe = fs.readFileSync("frontend/js/divination.js", "utf8");
ok(!/PROVINCES|provinceOptions|cityOptions|wireLocationCascade/.test(fe), "前端无城市坐标表/级联逻辑");
ok(!/body\.latitude|body\.longitude|body\.birthPlace/.test(fe), "前端不再提交经纬度/出生地");
const be = ["backend/validate.js", "backend/server.js", "backend/db.js"]
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");
ok(!/needLocation/.test(be), "后端无 needLocation 校验分支");
const stripComments = (s) => s.replace(/\/\/.*$/gm, "");
ok(!/经纬度/.test(stripComments(fe + be + fs.readFileSync("frontend/index.html", "utf8"))), "无经纬度文案（注释除外）");

// --- 行为层面：jsdom 跑 astro 表单 ---
const html = fs.readFileSync("frontend/index.html", "utf8");
const dom = new JSDOM(html, { url: "https://moontarot.tech/", runScripts: "dangerously" });
const { window } = dom;
global.window = window; global.document = window.document;
global.localStorage = window.localStorage; global.Event = window.Event;

let lastBody = null;
window.fetch = async (url, opts) => {
  const base = String(url).split("?")[0], method = (opts && opts.method) || "GET";
  if (base === "/api/divination/astro" && method === "POST") {
    lastBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 1, kind: "astro", chart: {},
      extra: { ascLon: null, bodies: [{ key: "sun", label: "太阳", sign: "金牛座", degInSign: "15°", house: null, lon: 45 }], houses: [], aspects: [] },
      reading: "测试解读" }) };
  }
  if (base === "/api/profile/birth") return { ok: true, json: async () => ({ profile: null }) };
  return { ok: true, json: async () => ({}) };
};
window.eval(fe);

const formHTML = document.getElementById("astro-form-wrap").innerHTML;
ok(!/出生地|经纬度|province|llwrap/.test(formHTML), "astro 表单无出生地/经纬度输入");
ok(/不含上升点与宫位/.test(formHTML), "astro 表单有无上升/宫位提示");

document.getElementById("astro-year").value = "1995";
document.getElementById("astro-month").value = "5";
document.getElementById("astro-day").value = "20";
document.getElementById("astro-hour").value = "14";

(async () => {
  document.getElementById("astro-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 300));
  ok(lastBody && lastBody.latitude === undefined && lastBody.longitude === undefined, "提交 body 无经纬度");
  ok(lastBody && lastBody.birthYear === 1995, "提交 body 出生日期正常");
  const svg = document.getElementById("astro-wheel").innerHTML;
  ok(!/星盘数据缺失/.test(svg) && /circle/.test(svg), "无上升点时星盘轮照常绘制");
  ok(!/ASC/.test(svg), "无上升点时不画 ASC 标记");
  ok(!!document.getElementById("bazi-form") && !!document.getElementById("ziwei-form"), "八字/紫微表单正常");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
