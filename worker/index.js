// =====================================================
//  Cloudflare Workers 入口
//  - /api/*  → worker 处理(图像/视频/上传/配置)
//  - 其他     → Workers Assets 托管 public/ 静态文件
// =====================================================
import { setEnv, getConfig } from './config.js';
import { generateImage } from './image.js';
import { submitVideo, getVideoStatus } from './video.js';
import { submitRunninghub, getRunninghubStatus, uploadRunninghub } from './runninghub.js';
import { setEnv as setAuthEnv, registerUser, loginUser, getUserProfile, genCode, storeEmailCode, verifyToken } from './auth.js';
import { atomicDeductCoins, refundCoins, getCoinLogs, redeemCard } from './coins.js';
import { supabaseHealth } from './supabase.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-base-url, x-rh-key, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
  });
}
function ok(data) { return json(200, { ok: true, ...data }); }
function err(status, message, extra = {}) {
  return json(status, { ok: false, error: message, ...extra });
}

// 从请求头读取用户自填的 API Key / Base URL (覆盖环境变量默认)
function getAuthFromReq(request) {
  const auth = {};
  const h = request.headers;
  if (h.get('x-api-key')) auth.apiKey = h.get('x-api-key');
  if (h.get('x-base-url')) auth.baseUrl = h.get('x-base-url');
  if (h.get('x-rh-key')) auth.rhKey = h.get('x-rh-key');
  return auth;
}

// 从 Authorization 头取用户 token 载荷 (未登录返回 null)
async function getUserFromReq(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  return await verifyToken(token);
}

// 即梦官方积分表(1积分=1金币):
//   2.5:       480P=12/秒 · 720P=26/秒 · 1080P=64/秒
//   2.0 Pro:   720P=14/秒 · 1080P=33/秒 · 4k=80/秒
//   2.0 mini:  仅 720P = 9/秒
//   2.0 Fast:  仅 720P = 5/秒
const SEEDANCE_RATE = { '480P': 12, '720P': 26, '1080P': 64 }; // 2.5
const SEEDANCE_PRO_RATE = { '720P': 14, '1080P': 33, '4k': 80 }; // 2.0 Pro
const SEEDANCE_MINI_RATE = { '720P': 9 }; // 2.0 mini
const SEEDANCE_FAST_RATE = { '720P': 5 }; // 2.0 Fast
function seedanceRateFor(model) {
  if (model === 'doubao-seedance-2-0-260128') return SEEDANCE_PRO_RATE;
  if (model === 'doubao-seedance-2.0-mini') return SEEDANCE_MINI_RATE;
  if (model === 'doubao-seedance-2-0-fast-260128') return SEEDANCE_FAST_RATE;
  return SEEDANCE_RATE;
}
function videoCost(model, quality, secs) {
  const table = seedanceRateFor(model);
  const q = Object.keys(table).includes(quality) ? quality : Object.keys(table)[0];
  const rate = table[q];
  const s = Math.max(1, Number(secs) || 5);
  return rate * s;
}

// 按模型返回积分价格
function coinCostFor(CONFIG, { type, model, flavor, params }) {
  const coins = CONFIG.coins || {};
  if (type === 'image') {
    if (model && model.includes('gpt-image-2-all')) return coins.gptAll || 5;
    if (model && model.includes('gpt-image-2')) return coins.gpt || 15;
    if (model && model.includes('gemini')) return coins.gemini || 10;
    return coins.doubaoImage || 5;
  }
  if (flavor === 'runninghub') return coins.runninghub || 30;
  // Seedance 视频: 按即梦积分表(模型×分辨率×时长)
  return videoCost(model, params?.quality, params?.duration);
}

// 上传用原生 formData 解析 (Workers 原生支持 multipart, 比 Node 手写可靠)
async function extractFile(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file) throw new Error('缺少 file 字段');
  const buffer = await file.arrayBuffer();
  return { buffer, filename: file.name || 'upload.bin' };
}

function inferContentType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4' }[ext] || 'application/octet-stream';
}

export default {
  async fetch(request, env) {
    // 注入环境变量 (API key 等)
    setEnv(env);
    setAuthEnv(env);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const auth = getAuthFromReq(request);
    const user = await getUserFromReq(request);

    try {
      // ---- 认证 / 积分路由 ----
      if (pathname === '/api/auth/send-code' && request.method === 'POST') {
        const body = await request.json();
        const email = String(body.email || '').trim();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, '邮箱格式不正确');
        const code = genCode();
        storeEmailCode(email, code);
        return ok({ message: '验证码已生成', devCode: env.ALLOW_DEV_CODE === 'true' ? code : undefined });
      }

      if (pathname === '/api/auth/register' && request.method === 'POST') {
        const body = await request.json();
        const r = await registerUser(body);
        if (!r.ok) return err(r.status || 400, r.error);
        return ok({ user: r.user, token: r.token });
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await request.json();
        const r = await loginUser(body);
        if (!r.ok) return err(r.status || 400, r.error);
        return ok({ user: r.user, token: r.token, bonusCoins: r.bonusCoins || 0 });
      }

      if (pathname === '/api/auth/me' && request.method === 'GET') {
        if (!user) return err(401, '未登录');
        const profile = await getUserProfile(user.id);
        if (!profile) return err(404, '用户不存在');
        return ok({ user: profile });
      }

      if (pathname === '/api/coins/logs' && request.method === 'GET') {
        if (!user) return err(401, '未登录');
        const logs = await getCoinLogs(user.id);
        return ok({ logs });
      }

      if (pathname === '/api/coins/redeem' && request.method === 'POST') {
        if (!user) return err(401, '未登录');
        const body = await request.json();
        const r = await redeemCard(user.id, body.key);
        if (!r.success) return err(400, r.error);
        return ok({ coins: r.coins, added: r.added });
      }

      if (pathname === '/api/health' && request.method === 'GET') {
        const db = await supabaseHealth();
        return ok({ status: 'ok', db });
      }

      // ---- 图像生成 ----
      if (pathname === '/api/generate-image' && request.method === 'POST') {
        const body = await request.json();
        let deducted = null;
        let cost = 0;
        if (user) {
          const CONFIG = getConfig();
          cost = coinCostFor(CONFIG, { type: 'image', model: body.model || body.params?.model });
          deducted = await atomicDeductCoins(user.id, cost, body.model || '图像生成');
          if (!deducted.success) return err(403, deducted.error);
        }
        try {
          const result = await generateImage({ ...body, auth });
          if (!result.ok) { if (deducted) await refundCoins(user.id, cost, body.model || '图像生成'); return err(400, result.error); }
          return ok(result);
        } catch (e) {
          if (deducted) await refundCoins(user.id, cost, body.model || '图像生成');
          return err(500, e.message || '生成失败');
        }
      }

      // ---- 视频提交 ----
      if (pathname === '/api/generate-video' && request.method === 'POST') {
        const body = await request.json();
        const { flavor, ...rest } = body;
        let deducted = null;
        let cost = 0;
        if (user) {
          const CONFIG = getConfig();
          const model = body.params?.model || rest.params?.model;
          cost = coinCostFor(CONFIG, { type: 'video', model, flavor, params: body.params || rest.params });
          deducted = await atomicDeductCoins(user.id, cost, flavor === 'runninghub' ? 'RunningHub 工作流' : '视频生成');
          if (!deducted.success) return err(403, deducted.error);
        }
        try {
          const result = flavor === 'runninghub'
            ? await submitRunninghub({ ...rest, auth })
            : await submitVideo({ ...rest, flavor, auth });
          if (!result.ok) { if (deducted) await refundCoins(user.id, cost, '视频生成'); return err(400, result.error); }
          return ok(result);
        } catch (e) {
          if (deducted) await refundCoins(user.id, cost, '视频生成');
          return err(500, e.message || '提交失败');
        }
      }

      // ---- 视频状态查询 ----
      const statusMatch = pathname.match(/^\/api\/video-status\/(.+)$/);
      if (statusMatch && request.method === 'GET') {
        const taskId = decodeURIComponent(statusMatch[1]);
        const flavor = url.searchParams.get('flavor') || undefined;
        const result = flavor === 'runninghub'
          ? await getRunninghubStatus({ taskId, auth })
          : await getVideoStatus({ taskId, flavor, auth });
        if (!result.ok) return err(400, result.error);
        return ok(result);
      }

      // ---- comfly 文件上传 ----
      if (pathname === '/api/upload' && request.method === 'POST') {
        const CONFIG = getConfig();
        const apiKey = (auth.apiKey || '').trim() || CONFIG.apiKey;
        const baseUrl = (auth.baseUrl || '').trim().replace(/\/+$/, '') || CONFIG.baseUrl;
        if (!apiKey) return err(400, '未配置 API key,请在右上角 API 设置中填写');
        const { buffer, filename } = await extractFile(request);
        const ct = inferContentType(filename);
        const form = new FormData();
        form.append('file', new Blob([buffer], { type: ct }), filename);

        const r = await fetch(baseUrl + CONFIG.upload.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (!r.ok) {
          return err(r.status, data?.error?.message || data?.message || `上游返回 ${r.status}`);
        }
        if (!data.url) {
          return err(502, '上传成功但响应里没有 url 字段');
        }
        return ok({ url: data.url, filename: data.filename, bytes: data.bytes });
      }

      // ---- RunningHub 文件上传 ----
      if (pathname === '/api/rh-upload' && request.method === 'POST') {
        const { buffer, filename } = await extractFile(request);
        const result = await uploadRunninghub({ buffer, filename, auth });
        if (!result.ok) return err(400, result.error);
        return ok(result);
      }

      // ---- 配置 schema (不暴露 apiKey) ----
      if (pathname === '/api/config' && request.method === 'GET') {
        const CONFIG = getConfig();
        return ok({
          image: { paramSchema: CONFIG.image.paramSchema, defaults: CONFIG.image.defaults },
          video: {
            flavors: {
              ark: { paramSchema: CONFIG.video.ark.paramSchema, defaults: CONFIG.video.ark.submit.defaults },
              comfly: { paramSchema: CONFIG.video.comfly.paramSchema, defaults: CONFIG.video.comfly.submit.defaults },
              runninghub: { paramSchema: CONFIG.video.runninghub.paramSchema, defaults: CONFIG.video.runninghub.defaults },
            },
            defaultFlavor: CONFIG.video.defaultFlavor,
          },
        });
      }

      // ---- 未匹配的 API 路径 ----
      if (pathname.startsWith('/api/')) {
        return err(404, `接口不存在: ${pathname}`);
      }

      // 静态文件交给 Workers Assets 处理
      return env.ASSETS.fetch(request);
    } catch (e) {
      return err(500, e.message || 'Internal Server Error');
    }
  },
};
