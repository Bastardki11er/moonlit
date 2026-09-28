/* ============================================================
   Moonlit feedback test
   Runs against an isolated backend copy in /tmp; never touches the real DB.
   Covers: validateFeedbackInput, saveFeedback/listFeedback round-trip,
   POST /api/feedback (200 / 400 / 429), GET /api/admin/feedback (200 / 401).
   Run: node tools/feedback-test.js
   ============================================================ */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawn } = require("child_process");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. isolate a backend copy with a FRESH database
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonlit-fb-test-"));
  execSync(`cp -r ${path.join(__dirname, "..", "backend")} ${path.join(dir, "backend")}`);
  for (const f of ["moonlit.db", "moonlit.db.bak", "moonlit.db-journal"])
    try { fs.unlinkSync(path.join(dir, "backend", f)); } catch (e) { /* not there */ }
  fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"));
  fs.symlinkSync(path.join(__dirname, "..", "frontend"), path.join(dir, "frontend")); // validate.js requires ../frontend/js/cards.js
  fs.writeFileSync(path.join(dir, "backend", ".env"), "ADMIN_TOKEN=test-token-123\n");
  const backendDir = path.join(dir, "backend");

  // 2. validate.js unit checks
  const v = require(path.join(backendDir, "validate.js"));
  ok(!v.validateFeedbackInput({ message: "太短" }).ok, "rejects message < 10 chars");
  ok(!v.validateFeedbackInput({ message: "x".repeat(2001) }).ok, "rejects message > 2000 chars");
  ok(!v.validateFeedbackInput({}).ok, "rejects missing message");
  const good = v.validateFeedbackInput({ category: "bug", contact: "  a@b.cn  ", message: "这里有个错别字，麻烦修一下谢谢" });
  ok(good.ok && good.clean.category === "bug" && good.clean.contact === "a@b.cn", "accepts valid input, trims contact");
  const weird = v.validateFeedbackInput({ category: "hack', DROP TABLE", message: "0123456789" });
  ok(weird.ok && weird.clean.category === "other", "unknown category falls back to other");

  // 3. db round-trip (feedback table created by schema migration)
  const userdb = await require(path.join(backendDir, "db.js")).init();
  const u = userdb.getOrCreateUser(null);
  const fid = userdb.saveFeedback(u.id, { category: "suggestion", contact: "u@qq.com", message: "希望加一个英文版的每日一牌" });
  ok(Number.isInteger(fid), "saveFeedback returns id");
  const items = userdb.listFeedback(100);
  ok(items.length === 1 && items[0].message === "希望加一个英文版的每日一牌" && items[0].status === "new",
    "listFeedback returns the saved row");

  // 4. HTTP: boot the real server on a test port
  const PORT = 4317;
  const srv = spawn("node", ["server.js"], {
    cwd: backendDir, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let started = false;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("server did not start")), 20000);
    srv.stdout.on("data", (d) => { if (d.toString().includes("Moonlit running")) { started = true; clearTimeout(to); resolve(); } });
    srv.stderr.on("data", (d) => process.stderr.write("[srv] " + d));
    srv.on("exit", (c) => { if (!started) { clearTimeout(to); reject(new Error("server exited " + c)); } });
  });
  const base = `http://127.0.0.1:${PORT}`;
  const post = (body) => fetch(base + "/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  let r = await post({ message: "短" });
  ok(r.status === 400, "POST short message -> 400");
  const bodies = [
    { category: "suggestion", contact: "t@qq.com", message: "第一条有效的用户反馈内容，超过十个字" },
    { category: "bug", message: "第二条反馈：页面上有个按钮点不动，麻烦看看" },
    { message: "第三条反馈内容，没有分类和联系方式也能提交" },
    { category: "other", message: "第四条反馈内容，用来占满限流额度" },
  ];
  for (const b of bodies) {
    r = await post({ userId: u.id, ...b });
    ok(r.status === 200, "POST valid feedback -> 200 (" + b.message.slice(0, 8) + "…)");
  }
  r = await post({ message: "第六条反馈，应该触发每小时5条的限流" });
  ok(r.status === 429, "6th POST within the hour -> 429 rate limited");

  r = await fetch(base + "/api/admin/feedback?token=test-token-123");
  const adminData = await r.json();
  ok(r.status === 200 && adminData.items.length === 5, "GET /api/admin/feedback with token -> 5 items (1 direct + 4 HTTP)");
  ok(adminData.items[0].contact === "t@qq.com" || adminData.items.some((x) => x.category === "bug"),
    "admin list carries category + contact");

  r = await fetch(base + "/api/admin/feedback?token=wrong");
  ok(r.status === 401, "GET /api/admin/feedback with wrong token -> 401");

  srv.kill();
  await sleep(500);
  execSync(`rm -rf ${dir}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e.message); process.exit(1); });
