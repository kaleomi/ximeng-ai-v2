// RunningHub API 代理 — Cloudflare Workers 版
// AI App (ComfyUI 工作流) 提交/查询/上传, 鉴权独立于 comfly
import { getConfig } from './config.js';

function resolveAuth(auth = {}) {
  const CONFIG = getConfig();
  const apiKey = (auth.rhKey || '').trim() || CONFIG.runninghub.apiKey;
  const baseUrl = CONFIG.runninghub.baseUrl.replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

function rhHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

// 上传文件 → 返回 { url(预览), filename(工作流引用) }
export async function uploadRunninghub({ buffer, filename, auth = {} }) {
  const CONFIG = getConfig();
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) return { ok: false, error: '未配置 RunningHub API Key' };

  const ext = (filename.split('.').pop() || '').toLowerCase();
  const ct = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4' }[ext] || 'application/octet-stream';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: ct }), filename);

  try {
    const r = await fetch(baseUrl + CONFIG.runninghub.upload.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return { ok: false, error: data?.message || `RunningHub 上传失败 ${r.status}` };
    }
    const d = data?.data;
    if (!d?.filename) {
      return { ok: false, error: '上传成功但响应缺少 filename', upstream: data };
    }
    return { ok: true, url: d.download_url || d.filename, filename: d.filename };
  } catch (err) {
    return { ok: false, error: `上传请求失败: ${err.message}` };
  }
}

// 构建 nodeInfoList — 按工作流节点映射
function buildNodeInfoList(prompt, params = {}) {
  const nodes = getConfig().runninghub.nodes;
  const list = [];

  if (params.ratio) {
    list.push({ nodeId: nodes.ratio.nodeId, fieldName: nodes.ratio.fieldName, fieldValue: params.ratio });
  }
  if (nodes.megapixels) {
    list.push({ nodeId: nodes.megapixels.nodeId, fieldName: nodes.megapixels.fieldName, fieldValue: nodes.megapixels.value });
  }
  if (nodes.duration) {
    list.push({ nodeId: nodes.duration.nodeId, fieldName: nodes.duration.fieldName, fieldValue: nodes.duration.value });
  }
  const refs = params.refImages || [];
  refs.forEach((file, i) => {
    const nodeId = nodes.images[i];
    if (nodeId && file) list.push({ nodeId, fieldName: 'image', fieldValue: file });
  });
  list.push({ nodeId: nodes.prompt.nodeId, fieldName: nodes.prompt.fieldName, fieldValue: prompt });

  return list;
}

export async function submitRunninghub({ prompt, params = {}, auth = {} }) {
  const CONFIG = getConfig();
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) return { ok: false, error: '未配置 RunningHub API Key' };
  if (!prompt) return { ok: false, error: 'prompt 不能为空' };

  const nodeInfoList = buildNodeInfoList(prompt, params);
  const body = {
    nodeInfoList,
    instanceType: params.instanceType || CONFIG.runninghub.instanceType,
    usePersonalQueue: params.usePersonalQueue || CONFIG.runninghub.usePersonalQueue,
  };

  try {
    const res = await fetch(baseUrl + CONFIG.runninghub.submit.endpoint.replace('{appId}', CONFIG.runninghub.appId), {
      method: 'POST',
      headers: rhHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return { ok: false, error: data?.errorMessage || data?.message || `RunningHub 提交失败 ${res.status}`, upstream: data };
    }
    if (data?.taskId) {
      return { ok: true, status: 'running', taskId: data.taskId, upstream: data };
    }
    return { ok: false, error: '提交成功但未返回 taskId', upstream: data };
  } catch (err) {
    return { ok: false, error: `提交请求失败: ${err.message}` };
  }
}

export async function getRunninghubStatus({ taskId, auth = {} }) {
  const CONFIG = getConfig();
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) return { ok: false, error: '未配置 RunningHub API Key' };
  if (!taskId) return { ok: false, error: 'taskId 不能为空' };

  try {
    const res = await fetch(baseUrl + CONFIG.runninghub.query.endpoint, {
      method: 'POST',
      headers: rhHeaders(apiKey),
      body: JSON.stringify({ taskId }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return { ok: false, error: data?.errorMessage || `RunningHub 查询失败 ${res.status}`, upstream: data };
    }

    const status = String(data?.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      const results = Array.isArray(data.results) ? data.results : [];
      const video = results.find(r => ['mp4', 'webm', 'mov'].includes(String(r.outputType || '').toLowerCase()));
      const any = results.find(r => r.url);
      const url = (video || any)?.url || null;
      if (url) return { ok: true, status: 'succeeded', url, upstream: data };
      return { ok: false, error: '任务成功但未找到结果 URL', upstream: data };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      return { ok: false, error: data?.errorMessage || `任务失败: ${status}`, upstream: data };
    }
    if (['QUEUED', 'RUNNING'].includes(status)) {
      return { ok: true, status: 'running', taskId, upstream: data };
    }
    return { ok: false, error: `未知状态: ${data?.status || status}`, upstream: data };
  } catch (err) {
    return { ok: false, error: `查询请求失败: ${err.message}` };
  }
}
