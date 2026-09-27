/* ============================================================
   Moonlit 会员权益测试（member perks）
   在 /tmp 的隔离 backend 副本上跑，不碰真实数据库。
   跑法：node tools/member-perks-test.js
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
  // 1. 隔离一份 backend（自带全新的 moonlit.db）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonlit-perk-test-"));
  execSync(`cp -r ${path.join(__dirname, "..", "backend")} ${path.join(dir, "backend")}`);
  fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"));
  const userdb = await require(path.join(dir, "backend", "db.js")).init();

  // ---- 时间穿越：doCheckin 用 new Date() 取"今天"，patch 它就能模拟连续签到
  const RealDate = Date;
  function travel(days) {
    const offset = days * 86400000;
    global.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [RealDate.now() + offset])); }
      static now() { return RealDate.now() + offset; }
    };
  }
  function resetTime() { global.Date = RealDate; }

  // 建一个游客 + 一个注册用户
  const guest = userdb.getOrCreateUser(null);
  const memberUser = userdb.getOrCreateUser(null);
  const acc = userdb.createAccount("perk@test.com", "123456");
  userdb.attachUserToAccount(memberUser.id, acc.id);

  console.log("== isRegistered ==");
  ok(userdb.isRegistered(guest.id) === false, "游客 isRegistered=false");
  ok(userdb.isRegistered(memberUser.id) === true, "注册用户 isRegistered=true");
  ok(userdb.isRegistered("00000000-0000-0000-0000-000000000000") === false, "不存在的用户 false");

  console.log("== 分享赚次数上限 ==");
  ok(userdb.grantShareBonus(guest.id).ok, "游客第1次分享 ok");
  ok(userdb.grantShareBonus(guest.id).ok, "游客第2次分享 ok");
  const g3 = userdb.grantShareBonus(guest.id);
  ok(!g3.ok && g3.reason === "daily_cap", "游客第3次分享被拒");
  ok(userdb.shareGrantsLeftToday(guest.id) === 0, "游客 grantsLeft=0");
  ok(userdb.grantShareBonus(memberUser.id).ok, "会员第1次分享 ok");
  ok(userdb.grantShareBonus(memberUser.id).ok, "会员第2次分享 ok");
  ok(userdb.grantShareBonus(memberUser.id).ok, "会员第3次分享 ok");
  const m4 = userdb.grantShareBonus(memberUser.id);
  ok(!m4.ok && m4.reason === "daily_cap", "会员第4次分享被拒");
  ok(userdb.getBonusReadings(guest.id) === 2, "游客 bonus=2");
  ok(userdb.getBonusReadings(memberUser.id) === 3, "会员 bonus=3");

  console.log("== 邀请奖励 ==");
  const n1 = userdb.getOrCreateUser(null);
  const r1 = userdb.applyReferral(n1.id, guest.id);
  ok(r1.applied && r1.rewardAmount === 1, "游客做推荐人：双方 +1");
  ok(userdb.getBonusReadings(n1.id) === 1, "被邀请人 +1 到账");
  const n2 = userdb.getOrCreateUser(null);
  const r2 = userdb.applyReferral(n2.id, memberUser.id);
  ok(r2.applied && r2.rewardAmount === 2, "会员做推荐人：双方 +2");
  ok(userdb.getBonusReadings(n2.id) === 2, "被邀请人 +2 到账");
  const n3 = userdb.getOrCreateUser(null);
  ok(userdb.applyReferral(n3.id, n3.id).applied === false, "自己邀请自己拒绝");
  ok(userdb.applyReferral(n1.id, memberUser.id).applied === false, "每人只能被邀请一次");
  ok(userdb.applyReferral(userdb.getOrCreateUser(null).id, "not-a-uuid").applied === false, "非法 ref 拒绝");
  // 推荐人每天最多 10 个
  const ref2 = userdb.getOrCreateUser(null);
  const acc2 = userdb.createAccount("perk2@test.com", "123456");
  userdb.attachUserToAccount(ref2.id, acc2.id);
  let appliedCount = 0;
  for (let i = 0; i < 12; i++) {
    if (userdb.applyReferral(userdb.getOrCreateUser(null).id, ref2.id).applied) appliedCount++;
  }
  ok(appliedCount === 10, "推荐人每天最多 10 个奖励（给了 " + appliedCount + "）");

  console.log("== 7 天签到奖励 ==");
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
  ok(gReward.rewardGranted && gReward.rewardAmount === 1, "游客第7天 +1");
  ok(mReward.rewardGranted && mReward.rewardAmount === 2, "会员第7天 +2");
  ok(userdb.getBonusReadings(g2.id) === 1, "游客签到 bonus=1");
  ok(userdb.getBonusReadings(m2u.id) === 2, "会员签到 bonus=2");
  ok(userdb.doCheckin(g2.id).duplicate === true, "重复签到 duplicate");
  ok(userdb.checkinStreak(g2.id).streak === 7, "连续 7 天 streak=7");

  console.log("== 追问计数 ==");
  ok(userdb.followupsToday(m2u.id) === 0, "今天还没追问过 =0");
  const rid = userdb.saveReading(m2u.id, { question: "q", spread: "s", cards: [], readingText: "t" });
  userdb.saveFollowup(rid, m2u.id, "qq", "aa");
  ok(userdb.followupsToday(m2u.id) === 1, "追问一次后 =1（会员今天不再免单）");

  console.log("== 出生信息记忆 ==");
  ok(userdb.getBirthProfile(m2u.id) === null, "没保存时返回 null");
  userdb.saveBirthProfile(m2u.id, {
    gender: "female", birthYear: 1998, birthMonth: 5, birthDay: 20,
    birthHour: 14, birthMinute: 30, calendarType: "solar", isLeapMonth: false,
    latitude: 31.23, longitude: 121.47, birthPlace: "上海",
  });
  const prof = userdb.getBirthProfile(m2u.id);
  ok(prof && prof.birth_year === 1998 && prof.birth_place === "上海", "保存后能读出");
  userdb.saveBirthProfile(m2u.id, {
    gender: "male", birthYear: 2000, birthMonth: 1, birthDay: 1,
    birthHour: 0, calendarType: "lunar", isLeapMonth: true,
  });
  const prof2 = userdb.getBirthProfile(m2u.id);
  ok(prof2.birth_year === 2000 && prof2.latitude === null && prof2.is_leap_month === 1, "重复保存覆盖旧数据");

  console.log("== 历史记录条数（db 层 limit 参数） ==");
  for (let i = 0; i < 5; i++) userdb.saveReading(g2.id, { question: "q" + i, cards: [], readingText: "t" });
  ok(userdb.getReadings(g2.id, 3).length === 3, "limit=3 返回 3 条");
  ok(userdb.getReadings(g2.id, 100).length >= 5, "limit=100 能拿全");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
