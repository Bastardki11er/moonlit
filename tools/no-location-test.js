/* No-location test: confirms the site no longer collects/uses lat-lon, and the astro wheel still renders without an ascendant.
   Run: node tools/no-location-test.js */
"use strict";
const fs = require("fs");
const { JSDOM } = require("jsdom");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name); }
}

// --- source level: no lat-lon remnants ---
const fe = fs.readFileSync("frontend/js/divination.js", "utf8");
ok(!/PROVINCES|provinceOptions|cityOptions|wireLocationCascade/.test(fe), "frontend has no city coordinate table/cascade logic");
ok(!/body\.latitude|body\.longitude|body\.birthPlace/.test(fe), "frontend no longer submits lat-lon/birthplace");
const be = ["backend/validate.js", "backend/server.js", "backend/db.js"]
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");
ok(!/needLocation/.test(be), "backend has no needLocation validation branch");
const stripComments = (s) => s.replace(/\/\/.*$/gm, "");
ok(!/经纬度/.test(stripComments(fe + be + fs.readFileSync("frontend/index.html", "utf8"))), "no lat-lon copy (except in comments)");

// --- behavior level: jsdom runs the astro form ---
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
ok(!/出生地|经纬度|province|llwrap/.test(formHTML), "astro form has no birthplace/lat-lon inputs");
ok(/不含上升点与宫位/.test(formHTML), "astro form has no-ascendant/houses notice");

document.getElementById("astro-year").value = "1995";
document.getElementById("astro-month").value = "5";
document.getElementById("astro-day").value = "20";
document.getElementById("astro-hour").value = "14";

(async () => {
  document.getElementById("astro-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 300));
  ok(lastBody && lastBody.latitude === undefined && lastBody.longitude === undefined, "submitted body has no lat-lon");
  ok(lastBody && lastBody.birthYear === 1995, "submitted body birth date looks right");
  const svg = document.getElementById("astro-wheel").innerHTML;
  ok(!/星盘数据缺失/.test(svg) && /circle/.test(svg), "wheel still renders without ascendant");
  ok(!/ASC/.test(svg), "no ASC marker without ascendant");
  ok(!!document.getElementById("bazi-form") && !!document.getElementById("ziwei-form"), "bazi/ziwei forms fine");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
