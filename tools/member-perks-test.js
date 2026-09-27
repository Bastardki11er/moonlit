/* ============================================================
   Moonlit member perks test
   Runs against an isolated backend copy in /tmp; never touches the real DB.
   Run: node tools/member-perks-test.js
   ============================================================ */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name); }
}

(async () => {
  // 1. isolate a backend copy (with a fresh moonlit.db)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonlit-perk-test-"));
  execSync(`cp -r ${path.join(__dirname, "..", "backend")} ${path.join(dir, "backend")}`);
  fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"));
  fs.symlinkSync(path.join(__dirname, "..", "frontend"), path.join(dir, "frontend")); // validate.js needs to require cards.js
  const userdb = await require(path.join(dir, "backend", "db.js")).init();

  // ---- time travel: doCheckin reads "today" via new Date(); patch it to simulate consecutive check-ins
  const RealDate = Date;
  function travel(days) {
    const offset = days * 86400000;
    global.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [RealDate.now() + offset])); }
      static now() { return RealDate.now() + offset; }
    };
  }
  function resetTime() { global.Date = RealDate; }

  // create one guest + one registered user
  const guest = userdb.getOrCreateUser(null);
  const memberUser = userdb.getOrCreateUser(null);
  const acc = userdb.createAccount("perk@test.com", "123456");
  userdb.attachUserToAccount(memberUser.id, acc.id);

  console.log("== isRegistered ==");
  ok(userdb.isRegistered(guest.id) === false, "guest isRegistered=false");
  ok(userdb.isRegistered(memberUser.id) === true, "member isRegistered=true");
  ok(userdb.isRegistered("00000000-0000-0000-0000-000000000000") === false, "nonexistent user → false");

  console.log("== share-to-earn cap ==");
  ok(userdb.grantShareBonus(guest.id).ok, "guest share #1 ok");
  ok(userdb.grantShareBonus(guest.id).ok, "guest share #2 ok");
  const g3 = userdb.grantShareBonus(guest.id);
  ok(!g3.ok && g3.reason === "daily_cap", "guest share #3 rejected");
  ok(userdb.shareGrantsLeftToday(guest.id) === 0, "guest grantsLeft=0");
  ok(userdb.grantShareBonus(memberUser.id).ok, "member share #1 ok");
  ok(userdb.grantShareBonus(memberUser.id).ok, "member share #2 ok");
  ok(userdb.grantShareBonus(memberUser.id).ok, "member share #3 ok");
  const m4 = userdb.grantShareBonus(memberUser.id);
  ok(!m4.ok && m4.reason === "daily_cap", "member share #4 rejected");
  ok(userdb.getBonusReadings(guest.id) === 2, "guest bonus=2");
  ok(userdb.getBonusReadings(memberUser.id) === 3, "member bonus=3");

  console.log("== referral rewards ==");
  const n1 = userdb.getOrCreateUser(null);
  const r1 = userdb.applyReferral(n1.id, guest.id);
  ok(r1.applied && r1.rewardAmount === 1, "guest as referrer: +1 both sides");
  ok(userdb.getBonusReadings(n1.id) === 1, "invitee gets +1");
  const n2 = userdb.getOrCreateUser(null);
  const r2 = userdb.applyReferral(n2.id, memberUser.id);
  ok(r2.applied && r2.rewardAmount === 2, "member as referrer: +2 both sides");
  ok(userdb.getBonusReadings(n2.id) === 2, "invitee gets +2");
  const n3 = userdb.getOrCreateUser(null);
  ok(userdb.applyReferral(n3.id, n3.id).applied === false, "self-referral rejected");
  ok(userdb.applyReferral(n1.id, memberUser.id).applied === false, "one referral per person ever");
  ok(userdb.applyReferral(userdb.getOrCreateUser(null).id, "not-a-uuid").applied === false, "invalid ref rejected");
  // referrer capped at 10/day
  const ref2 = userdb.getOrCreateUser(null);
  const acc2 = userdb.createAccount("perk2@test.com", "123456");
  userdb.attachUserToAccount(ref2.id, acc2.id);
  let appliedCount = 0;
  for (let i = 0; i < 12; i++) {
    if (userdb.applyReferral(userdb.getOrCreateUser(null).id, ref2.id).applied) appliedCount++;
  }
  ok(appliedCount === 10, "referrer gets at most 10 rewards/day (gave " + appliedCount + "）");

  console.log("== 7-day check-in reward ==");
  const g2 = userdb.getOrCreateUser(null);
  const m2u = userdb.getOrCreateUser(null);
  const acc3 = userdb.createAccount("perk3@test.com", "123456");
  userdb.attachUserToAccount(m2u.id, acc3.id);
  let gReward = null, mReward = null;
  for (let d = -6; d <= 0; d++) {
    travel(d);
    const rg = userdb.doCheckin(g2.id);
    const rm = userdb.doCheckin(m2u.id);
    if (d === 0) { gReward = rg; mReward = rm; }
  }
  resetTime();
  ok(gReward.rewardGranted && gReward.rewardAmount === 1, "guest day 7: +1");
  ok(mReward.rewardGranted && mReward.rewardAmount === 2, "member day 7: +2");
  ok(userdb.getBonusReadings(g2.id) === 1, "guest check-in bonus=1");
  ok(userdb.getBonusReadings(m2u.id) === 2, "member check-in bonus=2");
  ok(userdb.doCheckin(g2.id).duplicate === true, "repeat check-in → duplicate");
  ok(userdb.checkinStreak(g2.id).streak === 7, "7 consecutive days → streak=7");

  console.log("== follow-up counting ==");
  ok(userdb.followupsToday(m2u.id) === 0, "no follow-ups today = 0");
  const rid = userdb.saveReading(m2u.id, { question: "q", spread: "s", cards: [], readingText: "t" });
  userdb.saveFollowup(rid, m2u.id, "qq", "aa");
  ok(userdb.followupsToday(m2u.id) === 1, "after one follow-up = 1 (member's free one used up)");

  console.log("== birth profile memory ==");
  ok(userdb.getBirthProfile(m2u.id) === null, "returns null when nothing saved");
  userdb.saveBirthProfile(m2u.id, {
    gender: "female", birthYear: 1998, birthMonth: 5, birthDay: 20,
    birthHour: 14, birthMinute: 30, calendarType: "solar", isLeapMonth: false,
  });
  const prof = userdb.getBirthProfile(m2u.id);
  ok(prof && prof.birth_year === 1998 && prof.birth_minute === 30, "readable after save");
  userdb.saveBirthProfile(m2u.id, {
    gender: "male", birthYear: 2000, birthMonth: 1, birthDay: 1,
    birthHour: 0, calendarType: "lunar", isLeapMonth: true,
  });
  const prof2 = userdb.getBirthProfile(m2u.id);
  ok(prof2.birth_year === 2000 && prof2.latitude === undefined && prof2.is_leap_month === 1, "re-save overwrites old data");

  console.log("== history entry count (db-layer limit param) ==");
  for (let i = 0; i < 5; i++) userdb.saveReading(g2.id, { question: "q" + i, cards: [], readingText: "t" });
  ok(userdb.getReadings(g2.id, 3).length === 3, "limit=3 returns 3");
  ok(userdb.getReadings(g2.id, 100).length >= 5, "limit=100 gets everything");

  console.log("== register merges guest data ==");
  const gm = userdb.getOrCreateUser(null);
  userdb.grantShareBonus(gm.id);                       // +1 bonus reading
  userdb.doCheckin(gm.id);                             // 1 check-in day
  const gr = userdb.saveReading(gm.id, { question: "gq", cards: [], readingText: "gt" });
  userdb.saveFollowup(gr, gm.id, "gqq", "gaa");         // follow-up
  userdb.saveDivination(gm.id, { kind: "bazi", input: {}, chartJson: {}, readingText: "t", question: "q" });
  userdb.saveJournal(gm.id, { title: "t", content: "c" });
  const accM = userdb.createAccount("merge@test.com", "123456");
  const mm = userdb.getOrCreateUser(null);
  userdb.attachUserToAccount(mm.id, accM.id);
  userdb.mergeUsers(gm.id, mm.id);
  ok(userdb.getBonusReadings(mm.id) === 1, "bonus readings merged into account");
  ok(userdb.checkinStreak(mm.id).streak === 1, "check-in records merged into account");
  ok(userdb.getReadings(mm.id, 100).length === 1, "reading records merged into account");
  ok(userdb.followupsToday(mm.id) === 1, "follow-up records merged into account");
  ok(userdb.getDivinations(mm.id, "bazi", 20).length === 1, "chart records merged into account");
  ok(userdb.listJournal(mm.id, 50).length === 1, "journal merged into account");
  ok(userdb.getBonusReadings(gm.id) === 0, "old guest data cleared");
  ok(userdb.checkinStreak(gm.id).streak === 0, "old guest check-ins cleared");

  console.log("== guest gate (HTTP 401) ==");
  const { spawn } = require("child_process");
  const srv = spawn("node", [path.join(dir, "backend", "server.js")], {
    env: { ...process.env, PORT: "34561", ADMIN_TOKEN: "test" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 3000));
  const post = async (p, body, headers) => {
    const res = await fetch("http://localhost:34561" + p, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
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
  const registerWithCode = async (email) => {
    const sc = await post("/api/auth/send-code", { email, purpose: "register" });
    if (sc.status !== 200) throw new Error("send-code failed: " + JSON.stringify(sc.json));
    return post("/api/auth/register", { email, password: "123456", code: await readCode(email) });
  };
  try {
    const c1 = await post("/api/checkin", {});
    ok(c1.status === 401 && c1.json.needLogin === true, "guest check-in → 401 prompts login");
    const s1 = await post("/api/share-grant", {});
    ok(s1.status === 401 && s1.json.needLogin === true, "guest share-claim → 401 prompts login");
    const reg = await registerWithCode("gate@test.com");
    ok(reg.status === 200 && !!reg.json.token, "register succeeds, gets token");
    const H = { Authorization: "Bearer " + reg.json.token };
    const c2 = await post("/api/checkin", {}, H);
    ok(c2.status === 200 && c2.json.ok === true, "member check-in ok");
    const s2 = await post("/api/share-grant", {}, H);
    ok(s2.status === 200 && s2.json.ok === true, "member share-claim ok");
    // status endpoint stays open to guests (shows the prompt copy)
    const st = await (await fetch("http://localhost:34561/api/checkin/status?userId=x")).json();
    ok(typeof st.streak === "number", "check-in status open to guests");
  } finally {
    srv.kill();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
