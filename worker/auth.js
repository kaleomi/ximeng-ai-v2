// 认证模块 — Cloudflare Workers 版（与 server/auth.js 逻辑一致）
// 环境变量通过 setEnv(env) 注入（由 worker/index.js 调用）
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabaseFrom, setEnv as setSupabaseEnv } from './supabase.js';

let ENV = {};
export function setEnv(env) {
  ENV = env || {};
  setSupabaseEnv(ENV);
}

const JWT_SECRET = () => ENV.JWT_SECRET || 'running-hub-secret-key-2024';

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET(), { expiresIn: '7d' });
}
export function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET()); } catch { return null; }
}

export function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

// 邮箱验证码（内存存储，Workers 多副本下用 KV 更稳，先内存兜底）
const emailCodes = new Map();
export function storeEmailCode(email, code) { emailCodes.set(email, { code, expires: Date.now() + 5 * 60 * 1000 }); }
export function verifyEmailCode(email, code) {
  const rec = emailCodes.get(email);
  if (!rec) return false;
  if (Date.now() > rec.expires) { emailCodes.delete(email); return false; }
  if (rec.code !== code) return false;
  emailCodes.delete(email);
  return true;
}

function genInviteCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function registerUser({ username, password, nickname, email, code, inviteCode }) {
  if (!username || !password || !email || !code) return { ok: false, status: 400, error: '所有字段均为必填' };
  if (username.length < 3 || username.length > 20) return { ok: false, status: 400, error: '用户名长度需在 3-20 位' };
  if (password.length < 6) return { ok: false, status: 400, error: '密码至少 6 位' };
  if (!verifyEmailCode(email, code)) return { ok: false, status: 400, error: '邮箱验证码错误或已过期' };

  const { data: dupName } = await supabaseFrom('users').select('id').eq('username', username).maybeSingle();
  if (dupName) return { ok: false, status: 400, error: '用户名已被注册' };
  const { data: dupMail } = await supabaseFrom('users').select('id').eq('email', email).maybeSingle();
  if (dupMail) return { ok: false, status: 400, error: '邮箱已被注册' };

  const hashedPassword = await bcrypt.hash(password, 10);
  let inviterId = null;
  if (inviteCode) {
    const { data: inviter } = await supabaseFrom('users').select('id').eq('invite_code', inviteCode.trim().toUpperCase()).maybeSingle();
    if (inviter) inviterId = inviter.id;
  }
  const row = {
    username, password: hashedPassword, nickname: nickname || username, email,
    email_verified: true, invite_code: genInviteCode(), invited_by: inviterId,
    coins: 0, role: 'user', is_banned: false,
  };
  const { data: created, error } = await supabaseFrom('users').insert(row);
  if (error) {
    if (error.code === '23505') return { ok: false, status: 400, error: '用户名或邮箱已被注册' };
    return { ok: false, status: 500, error: `注册失败: ${error.message}` };
  }
  const user = Array.isArray(created) ? created[0] : created;

  if (inviterId) {
    const { data: inv } = await supabaseFrom('users').select('coins').eq('id', inviterId).maybeSingle();
    if (inv) {
      await supabaseFrom('users').eq('id', inviterId).update({ coins: (inv.coins || 0) + 5 });
      await supabaseFrom('coin_logs').insert({ user_id: inviterId, amount: 5, type: 'referral', description: `邀请好友 ${username} 注册奖励`, timestamp: Date.now() });
    }
  }
  const token = signToken(user);
  return { ok: true, user: { id: user.id, username: user.username, nickname: user.nickname, email: user.email, coins: user.coins || 0, role: user.role, invite_code: user.invite_code }, token };
}

export async function loginUser({ username, password }) {
  if (!username || !password) return { ok: false, status: 400, error: '用户名和密码不能为空' };
  const { data: user, error } = await supabaseFrom('users').select('*').eq('username', username).maybeSingle();
  if (error) return { ok: false, status: 500, error: `登录失败: ${error.message}` };
  if (!user || !(await bcrypt.compare(password, user.password || ''))) return { ok: false, status: 401, error: '用户名或密码错误' };
  if (user.is_banned) return { ok: false, status: 403, error: '您的账号已被封禁' };

  let coins = user.coins || 0;
  let bonusCoins = 0;
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  if (user.last_bonus_date !== today) {
    bonusCoins = Math.floor(Math.random() * 4);
    coins += bonusCoins;
    await supabaseFrom('users').eq('id', user.id).update({ coins, last_bonus_date: today });
    if (bonusCoins > 0) {
      await supabaseFrom('coin_logs').insert({ user_id: user.id, amount: bonusCoins, type: 'daily', description: `每日登录奖励 +${bonusCoins}`, timestamp: Date.now() });
    }
  }
  const token = signToken(user);
  return { ok: true, user: { id: user.id, username: user.username, nickname: user.nickname, email: user.email, coins, role: user.role, invite_code: user.invite_code, api_key: user.api_key || '', last_bonus_date: user.last_bonus_date }, token, bonusCoins };
}

export async function getUserProfile(userId) {
  const { data: user, error } = await supabaseFrom('users')
    .select('id, username, nickname, email, coins, role, invite_code, last_bonus_date, is_banned, api_key, created_at')
    .eq('id', userId).maybeSingle();
  if (error || !user) return null;
  return user;
}
