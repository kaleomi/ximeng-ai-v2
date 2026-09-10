// HTTP 服务: 静态文件托管 + /api/* 代理
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { generateImage } from './image.js';
import { submitVideo, getVideoStatus } from './video.js';
import { submitRunninghub, getRunninghubStatus, uploadRunninghub } from './runninghub.js';
import { registerUser, loginUser, getUserProfile, genCode, storeEmailCode, verifyToken } from './auth.js';
import { sendEmailCode } from './mailer.js';
import { atomicDeductCoins, refundCoins, getCoinLogs, redeemCard } from './coins.js';
import { supabaseHealth } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 1 << 20; // 1MB
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX) return reject(new Error('请求体过大'));
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

// 简单 multipart/form-data 解析 — 提取 file 字段的 Buffer + filename
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) return reject(new Error('缺少 boundary'));
    const boundary = Buffer.from('--' + (m[1] || m[2]));
    const chunks = [];
    let total = 0;
    const MAX = CONFIG.upload.maxSizeBytes;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX) {
        req.destroy();
        return reject(new Error('文件过大 (>' + (MAX / 1024 / 1024) + 'MB)'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const start = buf.indexOf(Buffer.concat([boundary, Buffer.from('\r\n')]));
        if (start < 0) return reject(new Error('找不到文件 part'));
        const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), start);
        if (headerEnd < 0) return reject(new Error('multipart 格式错'));
        const headerText = buf.slice(start + boundary.length + 2, headerEnd).toString('utf8');
        const filenameMatch = headerText.match(/filename="([^"]+)"/i);
        const filename = filenameMatch ? filenameMatch[1] : 'upload.bin';
        const endBoundary = buf.indexOf(Buffer.concat([boundary, Buffer.from('--')]), headerEnd + 4);
        const fileEnd = endBoundary > 0 ? endBoundary - 2 : buf.length;
        const fileBuf = buf.slice(headerEnd + 4, fileEnd);
        resolve({ buffer: fileBuf, filename });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...headers,
  });
  res.end(body);
}

function sendOk(res, data) { send(res, 200, { ok: true, ...data }); }
function sendErr(res, status, error) { send(res, status, { ok: false, error }); }

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 目录路径自动补 index.html（支持 /canvas/ 子应用）
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendErr(res, 403, 'Forbidden');


  fs.readFile(filePath, (err, buf) => {
    if (err) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      return fs.readFile(fallback, (e2, b2) => {
        if (e2) return sendErr(res, 404, 'Not Found');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(b2);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// 从请求头读取用户自填的 API Key / Base URL (覆盖 .env 默认)
function getAuthFromReq(req) {
  const auth = {};
  if (req.headers['x-api-key']) auth.apiKey = req.headers['x-api-key'];
  if (req.headers['x-base-url']) auth.baseUrl = req.headers['x-base-url'];
  if (req.headers['x-rh-key']) auth.rhKey = req.headers['x-rh-key'];
  return auth;
}

// 从 Authorization 头取用户 token 载荷 (未登录返回 null)
function getUserFromReq(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  return verifyToken(token);
}

// 按模型返回积分价格（可按需调整）
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

function coinCostFor({ type, model, flavor, params }) {
  if (type === 'image') {
    if (model && model.includes('gpt-image-2-all')) return CONFIG.coins.gptAll || 5;
    if (model && model.includes('gpt-image-2')) return CONFIG.coins.gpt || 15;
    if (model && model.includes('gemini')) return CONFIG.coins.gemini || 10;
    return CONFIG.coins.doubaoImage || 5;
  }
  if (flavor === 'runninghub') return CONFIG.coins.runninghub || 30;
  // Seedance 视频: 按即梦积分表(模型×分辨率×时长)
  return videoCost(model, params?.quality, params?.duration);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const auth = getAuthFromReq(req);
    const user = getUserFromReq(req);

    // ---- 认证 / 积分路由 ----
    if (url.pathname === '/api/auth/send-code' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendErr(res, 400, '邮箱格式不正确');
      const code = genCode();
      storeEmailCode(email, code);
      try {
        await sendEmailCode(email, code);
        return sendOk(res, { message: '验证码已发送' });
      } catch (e) {
        return sendErr(res, 500, '邮件发送失败: ' + (e.message || 'SMTP 错误'));
      }
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const r = await registerUser(body);
      if (!r.ok) return sendErr(res, r.status || 400, r.error);
      return sendOk(res, { user: r.user, token: r.token });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const r = await loginUser(body);
      if (!r.ok) return sendErr(res, r.status || 400, r.error);
      return sendOk(res, { user: r.user, token: r.token, bonusCoins: r.bonusCoins || 0 });
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      if (!user) return sendErr(res, 401, '未登录');
      const profile = await getUserProfile(user.id);
      if (!profile) return sendErr(res, 404, '用户不存在');
      return sendOk(res, { user: profile });
    }

    if (url.pathname === '/api/coins/logs' && req.method === 'GET') {
      if (!user) return sendErr(res, 401, '未登录');
      const logs = await getCoinLogs(user.id);
      return sendOk(res, { logs });
    }

    if (url.pathname === '/api/coins/redeem' && req.method === 'POST') {
      if (!user) return sendErr(res, 401, '未登录');
      const body = await readJsonBody(req);
      const r = await redeemCard(user.id, body.key);
      if (!r.success) return sendErr(res, 400, r.error);
      return sendOk(res, { coins: r.coins, added: r.added });
    }

    if (url.pathname === '/api/health' && req.method === 'GET') {
      const db = await supabaseHealth();
      return sendOk(res, { status: 'ok', db });
    }

    // ---- 生成类 API ----
    if (url.pathname === '/api/generate-image' && req.method === 'POST') {
      const body = await readJsonBody(req);
      // 扣费: 登录用户按模型扣积分
      let deducted = null;
      if (user) {
        const cost = coinCostFor({ type: 'image', model: body.model || body.params?.model });
        deducted = await atomicDeductCoins(user.id, cost, body.model || '图像生成');
        if (!deducted.success) return sendErr(res, 403, deducted.error);
      }
      try {
        const result = await generateImage({ ...body, auth });
        if (!result.ok) {
          if (deducted) await refundCoins(user.id, cost, body.model || '图像生成');
          return sendErr(res, 400, result.error);
        }
        return sendOk(res, result);
      } catch (e) {
        if (deducted) await refundCoins(user.id, cost, body.model || '图像生成');
        return sendErr(res, 500, e.message || '生成失败');
      }
    }

    if (url.pathname === '/api/generate-video' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { flavor, ...rest } = body;
      let deducted = null;
      const model = body.params?.model || rest.params?.model;
      const cost = coinCostFor({ type: 'video', model, flavor, params: body.params || rest.params });
      if (user) {
        deducted = await atomicDeductCoins(user.id, cost, flavor === 'runninghub' ? 'RunningHub 工作流' : '视频生成');
        if (!deducted.success) return sendErr(res, 403, deducted.error);
      }
      try {
        const result = flavor === 'runninghub'
          ? await submitRunninghub({ ...rest, auth })
          : await submitVideo({ ...rest, flavor, auth });
        if (!result.ok) {
          if (deducted) await refundCoins(user.id, cost, '视频生成');
          return sendErr(res, 400, result.error);
        }
        return sendOk(res, result);
      } catch (e) {
        if (deducted) await refundCoins(user.id, cost, '视频生成');
        return sendErr(res, 500, e.message || '提交失败');
      }
    }

    const statusMatch = url.pathname.match(/^\/api\/video-status\/(.+)$/);
    if (statusMatch && req.method === 'GET') {
      const taskId = decodeURIComponent(statusMatch[1]);
      const flavor = url.searchParams.get('flavor') || undefined;
      const result = flavor === 'runninghub'
        ? await getRunninghubStatus({ taskId, auth })
        : await getVideoStatus({ taskId, flavor, auth });
      if (!result.ok) return sendErr(res, 400, result.error);
      return sendOk(res, result);
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const apiKey = (auth.apiKey || '').trim() || CONFIG.apiKey;
      const baseUrl = (auth.baseUrl || '').trim().replace(/\/+$/, '') || CONFIG.baseUrl;
      if (!apiKey) return sendErr(res, 400, '未配置 API key,请在右上角 API 设置中填写');
      const { buffer, filename } = await parseMultipart(req);
      const form = new FormData();
      const ext = (filename.split('.').pop() || '').toLowerCase();
      const ct = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] || 'application/octet-stream';
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
        return sendErr(res, r.status, data?.error?.message || data?.message || `上游返回 ${r.status}`);
      }
      if (!data.url) {
        return sendErr(res, 502, '上传成功但响应里没有 url 字段');
      }
      return sendOk(res, { url: data.url, filename: data.filename, bytes: data.bytes });
    }

    if (url.pathname === '/api/rh-upload' && req.method === 'POST') {
      const { buffer, filename } = await parseMultipart(req);
      const result = await uploadRunninghub({ buffer, filename, auth });
      if (!result.ok) return sendErr(res, 400, result.error);
      return sendOk(res, result);
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      return sendOk(res, {
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

    // ---- 静态文件 ----
    return serveStatic(req, res);
  } catch (err) {
    return sendErr(res, 500, err.message || 'Internal Server Error');
  }
});

// 端口占用自动 +1
function listen(port, attempt = 0) {
  if (attempt > 10) {
    console.error('找不到可用端口');
    process.exit(1);
  }
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 被占用,尝试 ${port + 1}...`);
      listen(port + 1, attempt + 1);
    } else {
      throw err;
    }
  });
  server.once('listening', () => {
    const actual = server.address().port;
    console.log(`\n  Server running on http://localhost:${actual}\n`);
    console.log('  API 端点:');
    console.log('    POST /api/auth/register | login | send-code');
    console.log('    POST /api/generate-image');
    console.log('    POST /api/generate-video');
    console.log('    GET  /api/video-status/:taskId');
    console.log('    GET  /api/config\n');
  });
  server.listen(port);
}
listen(CONFIG.port);
