// 图像生成代理 — Cloudflare Workers 版 (多端点 generations / chat)
import { getConfig } from './config.js';

// 运行时配置(用户在前端自填 API Key / Base URL 时覆盖默认)
function resolveAuth(auth = {}) {
  const CONFIG = getConfig();
  const apiKey = (auth.apiKey || '').trim() || CONFIG.apiKey;
  const baseUrl = (auth.baseUrl || '').trim().replace(/\/+$/, '') || CONFIG.baseUrl;
  return { apiKey, baseUrl };
}

function getEndpoint(model) {
  const CONFIG = getConfig();
  const which = CONFIG.image.modelEndpoint?.[model] || 'generations';
  return CONFIG.image.endpoints[which];
}

// 从 chat 响应里提取图片 URL (markdown: ![image](url))
function extractChatImageUrl(data) {
  const CONFIG = getConfig();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const m = content.match(CONFIG.image.chatImagePattern);
  return m ? m[1] : null;
}

function buildBodyGenerations({ prompt, params }) {
  const model = params.model;
  const { size, n, seed, quality, image, guidance_scale, watermark, ...rest } = params;
  const body = { ...rest, prompt };

  // gpt-image-2 逆向组(gpt-image-2-all)只支持 model/prompt/size/image/quality
  const isReverse = model === 'gpt-image-2-all';
  if (!isReverse) {
    if (n != null) body.n = Number(n);
    if (seed != null && seed !== 0 && seed !== -1) body.seed = Number(seed);
  }
  if (size) body.size = size;
  if (quality && quality !== 'auto') body.quality = quality;

  // 官方建议显式要求 URL 返回
  if (model === 'gpt-image-2') body.response_format = 'url';

  // image 字段 — 按模型区分:
  //   gpt-image-2: 官方是数组(支持多图参考)
  //   即梦3(doubao-seedream-3-0) / 其他: spec 里 image 是 string(单图 URL)
  if (image) {
    if (model === 'gpt-image-2') {
      body.image = Array.isArray(image) ? image : [image];
    } else {
      body.image = Array.isArray(image) ? image[0] : image;
    }
  }

  // 即梦3 (doubao-seedream-3-0) 专有参数: guidance_scale / watermark
  if (model === 'doubao-seedream-3-0-t2i-250415') {
    if (guidance_scale != null && guidance_scale !== '') body.guidance_scale = Number(guidance_scale);
    if (watermark != null && watermark !== '') body.watermark = watermark === 'true';
  }
  return body;
}

function buildBodyChat({ prompt, params }) {
  return {
    model: params.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
}

export async function generateImage({ prompt, params = {}, auth = {} }) {
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) {
    return { ok: false, error: '未配置 API key,请检查环境变量或在右上角 API 设置中填写' };
  }
  if (!prompt) {
    return { ok: false, error: 'prompt 不能为空' };
  }

  const model = params.model || getConfig().image.defaults.model;
  const ep = getEndpoint(model);
  if (!ep) {
    return { ok: false, error: `模型 ${model} 没有配置端点` };
  }

  const isChat = ep === getConfig().image.endpoints.chat;
  const body = isChat
    ? buildBodyChat({ prompt, params })
    : buildBodyGenerations({ prompt, params });

  const reqUrl = baseUrl + ep.endpoint;

  try {
    const res = await fetch(reqUrl, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message || data?.message || `上游返回 ${res.status}`,
        upstream: data,
      };
    }

    if (isChat) {
      const url = extractChatImageUrl(data);
      if (!url) {
        return { ok: false, error: 'chat 响应里没找到图片', upstream: data };
      }
      return { ok: true, url, upstream: data };
    }

    // generations 模式 — n>1 时返回全部图片
    const items = data?.data || (Array.isArray(data) ? data : [data]);
    const urls = [], b64s = [];
    for (const it of items) {
      if (it && typeof it.url === 'string') urls.push(it.url);
      if (it && typeof it.b64_json === 'string') b64s.push(it.b64_json);
    }
    const images = urls.length ? urls : b64s.map((b) => `data:image/png;base64,${b}`);

    if (!images.length) {
      return { ok: false, error: '上游响应里找不到图片字段', upstream: data };
    }

    return { ok: true, url: urls[0] || null, b64: b64s[0] || null, images, upstream: data };
  } catch (err) {
    return { ok: false, error: `请求失败: ${err.message}` };
  }
}
