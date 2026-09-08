// 邮件发送 —— nodemailer + QQ SMTP (与夏洛熙一致)
// ⚠️ 邮箱账号/授权码必须从环境变量 EMAIL_USER / EMAIL_PASS 读取, 禁止硬编码
import nodemailer from 'nodemailer';

function getEnv(name, fallback = '') {
  return (typeof process !== 'undefined' && process.env && process.env[name]) || fallback;
}

let transporter = null;
export function getTransporter() {
  if (transporter) return transporter;
  const user = getEnv('EMAIL_USER');
  const pass = getEnv('EMAIL_PASS');
  if (!user || !pass) {
    throw new Error('未配置 EMAIL_USER / EMAIL_PASS 环境变量，无法发送邮件');
  }
  transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
  return transporter;
}

export async function sendEmailCode(email, code) {
  const user = getEnv('EMAIL_USER');
  const tp = getTransporter();
  await tp.sendMail({
    from: `"熙梦AI" <${user}>`,
    to: email,
    subject: '您的注册验证码',
    text: `您的验证码是：${code}，有效期 5 分钟。请勿泄露给他人。`,
    html: `<b>您的验证码是：<span style="color:#7c3aed;font-size:24px;">${code}</span></b><p>有效期 5 分钟。请勿泄露给他人。</p>`,
  });
}
