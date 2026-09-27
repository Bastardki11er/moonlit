/* ============================================================
   Moonlit email-code test
   Runs against an isolated backend copy in /tmp; never touches the real DB.
   Without SMTP configured, sending uses dev mode (logs only, no real emails).
   Run: node tools/email-code-test.js
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

  // time travel (minutes): db.js reads time via new Date(); patch it to simulate expiry
  const RealDate = Date;
  function travelMin(min) {
    const offset = min * 60000;
    global.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [RealDate.now() + offset])); }
      static now() { return RealDate.now() + offset; }
    };
  }
  function resetTime() { global.Date = RealDate; }

  console.log("== db: send-code / verify-code ==");
  const c1 = userdb.createEmailCode("a@test.com", "register");
  ok(/^\d{6}$/.test(c1), "code is 6 digits");
  ok(!!userdb.emailCodeSentAt("a@test.com", "register"), "code-sent time is queryable");
  ok(userdb.emailCodeSentAt("nobody@test.com", "register") === null, "never-sent email returns null");
  ok(userdb.verifyEmailCode("a@test.com", c1, "register").ok === true, "correct code passes");
  const reuse = userdb.verifyEmailCode("a@test.com", c1, "register");
  ok(reuse.ok === false, "code is one-time use: void after verify");
  const c2 = userdb.createEmailCode("b@test.com", "register");
  ok(userdb.verifyEmailCode("b@test.com", "000000", "register").ok === false, "wrong code rejected");
  for (let i = 0; i < 4; i++) userdb.verifyEmailCode("b@test.com", "000000", "register");
  const burned = userdb.verifyEmailCode("b@test.com", "000000", "register");
  ok(burned.ok === false && /重新获取/.test(burned.error), "voided after 5 wrong attempts");
  ok(userdb.verifyEmailCode("b@test.com", c2, "register").ok === false, "real code invalid after voiding");
  const c3 = userdb.createEmailCode("c@test.com", "register");
  travelMin(11);
  const expired = userdb.verifyEmailCode("c@test.com", c3, "register");
  ok(expired.ok === false && /过期/.test(expired.error), "expires after 10 minutes");
  resetTime();
  userdb.createEmailCode("d@test.com", "register");
  const c4b = userdb.createEmailCode("d@test.com", "register");
  ok(userdb.verifyEmailCode("d@test.com", c4b, "register").ok === true, "new code valid after resend");
  ok(userdb.verifyEmailCode("x@test.com", "123456", "register").ok === false, "verify-without-send rejected");

  console.log("== HTTP: send-code endpoint + registration ==");
  const srv = spawn("node", [path.join(dir, "backend", "server.js")], {
    env: { ...process.env, PORT: "34562", ADMIN_TOKEN: "test" }, // no SMTP_* → dev mode
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
  // read the code straight from the isolated DB file (server persists every write)
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
    ok(r.status === 400, "bad email → 400");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "weird" });
    ok(r.status === 400, "bad purpose → 400");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "register" });
    ok(r.status === 200 && r.json.ok === true && r.json.dev === true, "code sent (dev mode)");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "register" });
    ok(r.status === 429, "resend within 60s → 429");
    r = await post("/api/auth/register", { email: "e1@test.com", password: "123456" });
    ok(r.status === 400 && /验证码/.test(r.json.error || ""), "register without code → 400");
    r = await post("/api/auth/register", { email: "e1@test.com", password: "123456", code: "000000" });
    ok(r.status === 400, "wrong code → 400");
    const code = await readCode("e1@test.com");
    ok(/^\d{6}$/.test(code || ""), "code readable from DB");
    r = await post("/api/auth/register", { email: "e1@test.com", password: "123456", code });
    ok(r.status === 200 && !!r.json.token, "correct code → registered, got token");
    r = await post("/api/auth/send-code", { email: "e1@test.com", purpose: "register" });
    ok(r.status === 400 && /注册过/.test(r.json.error || ""), "registered email gets no new code");
  } finally {
    srv.kill();
  }

  console.log("== frontend static checks ==");
  const FE = path.join(__dirname, "..", "frontend");
  const html = fs.readFileSync(path.join(FE, "index.html"), "utf8");
  ok(html.includes('id="auth-code-row"'), "index.html has code input row");
  ok(html.includes('id="auth-send-code"'), "index.html has send-code button");
  const appjs = fs.readFileSync(path.join(FE, "js", "app.js"), "utf8");
  ok(appjs.includes("/api/auth/send-code"), "app.js calls send-code endpoint");
  ok(appjs.includes("startCodeCountdown") || /60.*重发/.test(appjs), "app.js has 60s countdown");
  ok(/code/.test(appjs) && appjs.includes("auth-code"), "register submit carries code");
  const css = fs.readFileSync(path.join(FE, "css", "styles.css"), "utf8");
  ok(css.includes(".auth-code-row"), "CSS has code-row styles");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
