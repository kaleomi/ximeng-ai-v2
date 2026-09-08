// 视频生成代理 — 支持 ark / comfly 两套接口,内部带服务端轮询兜底
import { CONFIG } from './config.js';

// 运行时配置(用户在前端自填 API Key / Base URL 时覆盖默认)
function resolveAuth(auth = {}) {
  const apiKey = (auth.apiKey || '').trim() || CONFIG.apiKey;
  const baseUrl = (auth.baseUrl || '').trim().replace(/\/+$/, '') || CONFIG.baseUrl;
  return { apiKey, baseUrl };
}

function getFlavor(flavor) {
  return CONFIG.video[flavor] || CONFIG.video[CONFIG.video.defaultFlavor];
}

function pickStatus(data, statusField) {
  if (!data) return undefined;
  return data[statusField] ?? data?.state ?? data?.task_status;
}

function classifyStatus(s, flavor) {
  const cfg = getFlavor(flavor);
  const v = String(s ?? '').toLowerCase();
  if (cfg.status.successValues.includes(v)) return 'succeeded';
  if (cfg.status.failedValues.includes(v)) return 'failed';
  if (cfg.status.runningValues.includes(v)) return 'running';
  return 'unknown';
}

function extractResult(data, flavor) {
  const cfg = getFlavor(flavor);
  // 1) 顶层字段
  for (const f of cfg.status.resultFields) {
    const v = data?.[f];
    if (typeof v === 'string' && v.startsWith('http')) return { url: v };
    if (typeof v === 'string' && v.length > 100) return { b64: v };
  }
  // 2) 嵌套路径
  for (const path of cfg.status.nestedResultPaths) {
    let cur = data;
    for (const k of path) cur = cur?.[k];
    if (typeof cur === 'string' && cur.startsWith('http')) return { url: cur };
    if (typeof cur === 'string' && cur.length > 100) return { b64: cur };
  }
  // 3) ARK 数组形式: content: [{ video_url:{url}, ... }]
  if (Array.isArray(data?.content)) {
    for (const item of data.content) {
      if (item?.video_url?.url) return { url: item.video_url.url };
      if (item?.url && typeof item.url === 'string' && item.url.startsWith('http')) return { url: item.url };
    }
  }
  // 4) content 是对象: { video_url:{url:"..."} } (ARK 查询响应常见)
  if (data?.content && !Array.isArray(data.content)) {
    if (data.content.video_url?.url) return { url: data.content.video_url.url };
    if (typeof data.content.video_url === 'string') return { url: data.content.video_url };
    if (data.content.url) return { url: data.content.url };
  }
  // 5) OpenAI 兼容 fallback: data: [{ url, b64_json }]
  if (Array.isArray(data?.data) && data.data[0]) {
    const first = data.data[0];
    if (first.url) return { url: first.url };
    if (first.b64_json) return { b64: first.b64_json };
    if (first.video_url) return { url: first.video_url };
  }
  return null;
}

function extractTaskId(data, flavor) {
  const field = getFlavor(flavor).submit.taskIdField;
  return data?.[field] || data?.taskId || data?.id || data?.data?.id;
}

function authHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function submitVideo({ prompt, params = {}, flavor, auth = {} }) {
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) return { ok: false, error: '未配置 API key,请检查 .env 文件或在右上角 API 设置中填写' };
  if (!prompt) return { ok: false, error: 'prompt 不能为空' };

  const cfg = getFlavor(flavor);
  const defaults = cfg.submit.defaults;
  const merged = { ...defaults, ...params };
  // 移除占位 seed
  if (merged.seed === 0 || merged.seed == null) delete merged.seed;
  const body = cfg.submit.buildBody({ prompt, params: merged });

  try {
    const res = await fetch(baseUrl + cfg.submit.endpoint, {
      method: cfg.submit.method,
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message || data?.message || data?.error?.code || `上游返回 ${res.status}`,
        upstream: data,
      };
    }

    const statusVal = pickStatus(data, cfg.status.statusField);
    const classified = classifyStatus(statusVal, flavor);
    const result = extractResult(data, flavor);
    const taskId = extractTaskId(data, flavor);

    // 运气好一次就完成
    if (classified === 'succeeded' && result) {
      return { ok: true, status: 'succeeded', flavor, ...result, upstream: data };
    }

    if (!taskId) {
      return {
        ok: false,
        error: '提交成功但未返回 task_id,且响应里也没视频结果',
        upstream: data,
        body: body,
      };
    }

    // 服务端轮询兜底 — 只有 ark 走兜底(comfly/wan 由前端轮询)
    if (flavor !== 'ark') {
      return { ok: true, status: 'running', taskId, flavor, upstream: data };
    }
    const { maxAttempts, intervalMs } = CONFIG.video.serverPoll;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const polled = await getVideoStatus({ taskId, flavor, auth });
      if (polled.ok && polled.status === 'succeeded') {
        return { ok: true, flavor, ...polled, upstream: { submit: data, poll: polled.upstream } };
      }
      if (polled.ok && polled.status === 'failed') {
        return { ok: false, error: polled.error || '视频生成失败', upstream: polled.upstream };
      }
    }
    // 还在跑,把 task_id 交给前端继续轮询
    return { ok: true, status: 'running', taskId, flavor, upstream: data };
  } catch (err) {
    return { ok: false, error: `请求失败: ${err.message}` };
  }
}

export async function getVideoStatus({ taskId, flavor, auth = {} }) {
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) return { ok: false, error: '未配置 API key,请检查 .env 文件或在右上角 API 设置中填写' };
  if (!taskId) return { ok: false, error: 'taskId 不能为空' };

  const cfg = getFlavor(flavor);
  const url = baseUrl + cfg.status.endpoint.replace('{taskId}', encodeURIComponent(taskId));
  try {
    const res = await fetch(url, {
      method: cfg.status.method,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return { ok: false, error: `上游返回 ${res.status}`, upstream: data };
    }

    const statusVal = pickStatus(data, cfg.status.statusField);
    const classified = classifyStatus(statusVal, flavor);

    if (classified === 'succeeded') {
      const result = extractResult(data, flavor);
      return { ok: true, status: 'succeeded', flavor, ...(result || {}), upstream: data };
    }
    if (classified === 'running') {
      return { ok: true, status: 'running', taskId, flavor, upstream: data };
    }
    if (classified === 'failed') {
      return { ok: false, error: data?.error?.message || `视频任务失败: ${statusVal}`, upstream: data };
    }
    return { ok: false, error: `未知状态: ${statusVal}`, upstream: data };
  } catch (err) {
    return { ok: false, error: `请求失败: ${err.message}` };
  }
}
