/* ============================================================
   Moonlit 邮箱验证码测试
   在 /tmp 的隔离 backend 副本上跑，不碰真实数据库。
   SMTP 未配置 → 发码走 dev 模式（只打日志，不真发邮件）。
   跑法：node tools/email-code-test.js
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonlit-email-test-"));
  execSync(`cp -r ${path.join(__dirname, "..", "backend")} ${path.join(dir, "backend")}`);
  fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"));
  fs.symlinkSync(path.join(__dirname, "..", "frontend"), path.join(dir, "frontend"));
  const userdb = await require(path.join(dir, "backend", "db.js")).init();

  // 时间穿越（分钟）：db.js 用 new Date() 取时间，patch 它就能模拟过期
  const RealDate = Date;
  function travelMin(min) {
    const offset = min * 60000;
    global.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [RealDate.now() + offset])); }
      static now() { return RealDate.now() + offset; }
    };
  }
  function resetTime() { global.Date = RealDate; }

  console.log("== db: 发码 / 验码 ==");
  const c1 = userdb.createEmailCode("a@test.com", "register");
  ok(/^\d{6}$/.test(c1), "验证码是 6 位数字");
  ok(!!userdb.emailCodeSentAt("a@test.com", "register"), "发码时间可查");
  ok(userdb.emailCodeSentAt("nobody@test.com", "register") === null, "没发过的邮箱返回 null");
  ok(userdb.verifyEmailCode("a@test.com", c1, "register").ok === true, "正确验证码通过");
  const reuse = userdb.verifyEmailCode("a@test.com", c1, "register");
  ok(reuse.ok === false, "验证码一次性使用，验过即废");
  const c2 = userdb.createEmailCode("b@test.com", "register");
  ok(userdb.verifyEmailCode("b@test.com", "000000", "register").ok === false, "错误验证码被拒");
  for (let i = 0; i < 4; i++) userdb.verifyEmailCode("b@test.com", "000000", "register");
  const burned = userdb.verifyEmailCode("b@test.com", "000000", "register");
  ok(burned.ok === false && /重新获取/.test(burned.error), "连续 5 次验错后作废");
  ok(userdb.verifyEmailCode("b@test.com", c2, "register").ok === false, "作废后真码也无效");
  const c3 = userdb.createEmailCode("c@test.com", "register");
  travelMin(11);
  const expired = userdb.verifyEmailCode("c@test.com", c3, "register");
  ok(expired.ok === false && /过期/.test(expired.error), "10 分钟后过期");
  resetTime();
  userdb.createEmailCode("d@test.com", "register");
  const c4b = userdb.createEmailCode("d@test.com", "register");
  ok(userdb.verifyEmailCode("d@test.com", c4b, "register").ok === true, "重发后新码有效");
  ok(userdb.verifyEmailCode("x@test.com", "123456", "register").ok === false, "没发过码直接验被拒");

  console.log("== HTTP: 发码接口 + 注册验码 ==");
  const srv = spawn("node", [path.join(dir, "backend", "server.js")], {
    env: { ...process.env, PORT: "34562", ADMIN_TOKEN: "test" }, // 无 SMTP_* → dev 模式
    stdio: "ignore",
  });
  await sleep(3000);
  const post = async (p, body) => {
    const res = await fetch("http://localhost:34562" + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  // 直接读隔离 DB 文件拿验证码（server 每次写都落盘）
  const readCode = async (email) => {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(path.join(dir, "backend", "moonlit.db")));
    const stmt = db.prepare("SELECT code FROM email_codes WHERE email = ? AND purpose = 'register'");
    stmt.bind([email]);
    const code = stmt.step() ? stmt.getAsObject().code : null;
    stmt.free(); db.close();
    return code;
  };
  try {
    let r = await post("/api/auth/send-code", { email: "not-an-email", purpose: "register" });
    ok(r.status === 400, "非法邮箱 → 400");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "weird" });
    ok(r.status === 400, "非法 purpose → 400");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "register" });
    ok(r.status === 200 && r.json.ok === true && r.json.dev === true, "发码成功（dev 模式）");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "register" });
    ok(r.status === 429, "60 秒内重发 → 429");
    r = await post("/api/auth/register", { email: "e1@test.com", password: "123456" });
    ok(r.status === 400 && /验证码/.test(r.json.error || ""), "不带验证码注册 → 400");
    r = await post("/api/auth/register", { email: "e1@test.com", password: "123456", code: "000000" });
    ok(r.status === 400, "验证码错误 → 400");
    const code = await readCode("e1@test.com");
    ok(/^\d{6}$/.test(code || ""), "能从 DB 读到验证码");
    r = await post("/api/auth/register", { email: "e1@test.com", password: "123456", code });
    ok(r.status === 200 && !!r.json.token, "验证码正确 → 注册成功拿 token");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "register" });
    ok(r.status === 400 && /注册过/.test(r.json.error || ""), "已注册邮箱不再发码");
  } finally {
    srv.kill();
  }

  console.log("== 前端静态检查 ==");
  const FE = path.join(__dirname, "..", "frontend");
  const html = fs.readFileSync(path.join(FE, "index.html"), "utf8");
  ok(html.includes('id="auth-code-row"'), "index.html 有验证码输入行");
  ok(html.includes('id="auth-send-code"'), "index.html 有发送验证码按钮");
  const appjs = fs.readFileSync(path.join(FE, "js", "app.js"), "utf8");
  ok(appjs.includes("/api/auth/send-code"), "app.js 调用发码接口");
  ok(appjs.includes("startCodeCountdown") || /60.*重发/.test(appjs), "app.js 有 60 秒倒计时");
  ok(/code/.test(appjs) && appjs.includes("auth-code"), "注册提交携带 code");
  const css = fs.readFileSync(path.join(FE, "css", "styles.css"), "utf8");
  ok(css.includes(".auth-code-row"), "CSS 有验证码行样式");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
