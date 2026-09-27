/* 邮箱验证码发件模块。
默认用 QQ 邮箱 SMTP（smtp.qq.com:465），需要 QQ 邮箱开启 SMTP 并生成授权码：
QQ 邮箱 → 设置 → 账号 → POP3/IMAP/SMTP → 开启 SMTP 服务 → 生成授权码
环境变量：
SMTP_HOST 默认 smtp.qq.com
SMTP_PORT 默认 465
SMTP_USER 发件邮箱，如 3317927502@qq.com
SMTP_PASS QQ 邮箱授权码（不是 QQ 密码！）
SMTP_FROM 发件人显示名，默认 "月光塔罗 <SMTP_USER>"
未配置 SMTP_USER/SMTP_PASS 时进入 dev 模式：只在控制台打印验证码，
方便本地开发和自动化测试，不会真发邮件。生产环境务必配置。 */

const SMTP_HOST = process.env.SMTP_HOST || "smtp.qq.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || `月光塔罗 <${SMTP_USER}>`;

function isConfigured() {
return!!(SMTP_USER && SMTP_PASS);
}

let transporter = null;
function getTransporter() {
if (!transporter) {
const nodemailer = require("nodemailer");
transporter = nodemailer.createTransport({
host: SMTP_HOST,
port: SMTP_PORT,
secure: SMTP_PORT === 465, // 465 走 SSL，587 走 STARTTLS
auth: { user: SMTP_USER, pass: SMTP_PASS},
});
}
return transporter;
}

function codeEmailHtml(code) {
return `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0d0b1e;color:#e8e4f5;border-radius:12px;">
<h2 style="color:#d4af37;margin:0 0 16px;">🌙 月光塔罗</h2>
<p style="font-size:15px;line-height:1.8;">你的邮箱验证码是：</p>
<p style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#d4af37;margin:16px 0;">${code}</p>
<p style="font-size:13px;color:#9a94b8;line-height:1.8;">10 分钟内有效，请尽快完成验证。<br>如果你没有注册月光塔罗，请忽略这封邮件。</p>
<p style="font-size:12px;color:#6b6585;margin-top:24px;">— 月光塔罗 moontarot.tech</p>
</div>`;
}

async function sendEmailCode(to, code) {
const subject = "邮箱验证码";
const text =
`你的验证码是 ${code}，10 分钟内有效。\n\n` +
`如果你没有注册月光塔罗，请忽略这封邮件。\n` +
`— 月光塔罗 moontarot.tech`;
if (!isConfigured()) {
console.log(`[email-dev] verification code for ${to}: ${code}`);
return { ok: true, dev: true};
}
await getTransporter().sendMail({
from: SMTP_FROM,
to,
subject,
text,
html: codeEmailHtml(code),
});
return { ok: true};
}

module.exports = { sendEmailCode, isConfigured};
