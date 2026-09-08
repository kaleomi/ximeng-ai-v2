// 积分模块 — Cloudflare Workers 版（与 server/coins.js 逻辑一致）
import { supabaseFrom } from './supabase.js';

export async function atomicDeductCoins(userId, amount, modeName) {
  if (!userId || !amount) return { success: false, error: '参数错误' };
  let retries = 3;
  while (retries > 0) {
    const { data: user, error: fetchError } = await supabaseFrom('users').select('coins').eq('id', userId).maybeSingle();
    if (fetchError || !user) return { success: false, error: '获取用户信息失败' };
    if ((user.coins || 0) < amount) return { success: false, error: `余额不足，需要 ${amount} 金币，当前仅剩 ${user.coins} 金币` };
    const { data, error: updateError } = await supabaseFrom('users').eq('id', userId).eq('coins', user.coins).update({ coins: user.coins - amount });
    if (!updateError && data && data.length > 0) {
      await supabaseFrom('coin_logs').insert({ user_id: userId, amount: -amount, type: 'usage', description: `生成任务支出 (${modeName})`, timestamp: Date.now() });
      return { success: true, remaining: user.coins - amount };
    }
    retries--;
  }
  return { success: false, error: '扣费失败，请重试' };
}

export async function addCoins(userId, amount, type, description) {
  const { data: user, error } = await supabaseFrom('users').select('coins').eq('id', userId).maybeSingle();
  if (error || !user) return { success: false, error: '用户不存在' };
  const newCoins = (user.coins || 0) + amount;
  const { error: upErr } = await supabaseFrom('users').eq('id', userId).update({ coins: newCoins });
  if (upErr) return { success: false, error: upErr.message };
  await supabaseFrom('coin_logs').insert({ user_id: userId, amount, type, description: description || '', timestamp: Date.now() });
  return { success: true, coins: newCoins };
}

export async function refundCoins(userId, amount, modeName) {
  if (!amount || amount <= 0) return;
  try {
    const { data: user } = await supabaseFrom('users').select('coins').eq('id', userId).maybeSingle();
    if (user) {
      await supabaseFrom('users').eq('id', userId).update({ coins: (user.coins || 0) + amount });
      await supabaseFrom('coin_logs').insert({ user_id: userId, amount, type: 'refund', description: `生成任务失败返还 (${modeName})`, timestamp: Date.now() });
    }
  } catch (e) { /* ignore */ }
}

export async function getCoinLogs(userId, limit = 50) {
  const { data, error } = await supabaseFrom('coin_logs').select('*').eq('user_id', userId).order('timestamp', { ascending: false }).limit(limit).execute();
  if (error) return [];
  return data || [];
}

export async function redeemCard(userId, rawKey) {
  const cleanKey = String(rawKey || '').toUpperCase().trim();
  if (!cleanKey) return { success: false, error: '请输入卡密' };
  const { data: keyRecord, error: fErr } = await supabaseFrom('recharge_keys').select('*').eq('key', cleanKey).maybeSingle();
  if (fErr || !keyRecord) return { success: false, error: '充值卡密无效' };
  if (keyRecord.is_used) return { success: false, error: '该充值卡密已被使用' };
  const { data: user } = await supabaseFrom('users').select('coins').eq('id', userId).maybeSingle();
  if (!user) return { success: false, error: '用户不存在' };
  const { error: ukErr } = await supabaseFrom('recharge_keys').eq('id', keyRecord.id).update({ is_used: true, used_by: userId, used_at: new Date().toISOString() });
  if (ukErr) return { success: false, error: '卡密使用失败' };
  const newCoins = (user.coins || 0) + keyRecord.coins;
  await supabaseFrom('users').eq('id', userId).update({ coins: newCoins });
  await supabaseFrom('coin_logs').insert({ user_id: userId, amount: keyRecord.coins, type: 'recharge', description: `卡密兑换: ${cleanKey}`, timestamp: Date.now() });
  return { success: true, coins: newCoins, added: keyRecord.coins };
}
