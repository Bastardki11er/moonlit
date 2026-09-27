const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync("frontend/admin.html", "utf8");
const dom = new JSDOM(html, { url: "https://moontarot.tech/admin.html", runScripts: "dangerously" });
const { window } = dom;
const $ = (id) => window.document.getElementById(id);
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.log("FAIL:", n)); if (c) console.log("  ✓ " + n); };

(async () => {
ok($("token").type === "password", "初始为密码框");
// 敲字符 → 短暂明文
$("token").value = "a";
$("token").dispatchEvent(new window.Event("input", { bubbles: true }));
ok($("token").type === "text", "敲字后短暂明文显示");
ok($("pw-count").textContent === "已输入 1 位", "字数提示更新");
// 1 秒后变回密码框
await new Promise((r) => setTimeout(r, 1200));
ok($("token").type === "password", "1 秒后恢复为 •");
// 手动切换到显示模式后，敲字不再闪回
$("toggle-pw").click();
ok($("token").type === "text" && $("toggle-pw").textContent === "🙈", "手动切换显示");
$("token").value = "ab";
$("token").dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1200));
ok($("token").type === "text", "显示模式下保持明文");
// 切回隐藏
$("toggle-pw").click();
ok($("token").type === "password", "再点隐藏回去");
// 清空
$("token").value = "";
$("token").dispatchEvent(new window.Event("input", { bubbles: true }));
ok($("pw-count").hidden === true, "清空后字数提示隐藏");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
