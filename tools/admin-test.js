const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync("frontend/admin.html", "utf8");
const dom = new JSDOM(html, { url: "https://moontarot.tech/admin.html", runScripts: "dangerously" });
const { window } = dom;
const $ = (id) => window.document.getElementById(id);
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// 初始是 password 类型
ok($("token").type === "password", "初始为密码框");
// 模拟粘贴/输入
$("token").value = "abc123";
$("token").dispatchEvent(new window.Event("input", { bubbles: true }));
ok($("pw-count").textContent === "已输入 6 位", "字数提示: " + $("pw-count").textContent);
// 切换显示
$("toggle-pw").click();
ok($("token").type === "text", "点👁后明文显示");
ok($("toggle-pw").textContent === "🙈", "图标切换");
$("toggle-pw").click();
ok($("token").type === "password", "再点隐藏回去");
// 清空后提示消失
$("token").value = "";
$("token").dispatchEvent(new window.Event("input", { bubbles: true }));
ok($("pw-count").hidden === true, "清空后字数提示隐藏");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
