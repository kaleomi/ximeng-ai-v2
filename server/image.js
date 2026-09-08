// 图像生成代理 — 支持多端点 (generations / chat)
import { CONFIG } from './config.js';

// 运行时配置(用户在前端自填 API Key / Base URL 时覆盖默认)
function resolveAuth(auth = {}) {
  const apiKey = (auth.apiKey || '').trim() || CONFIG.apiKey;
  const baseUrl = (auth.baseUrl || '').trim().replace(/\/+$/, '') || CONFIG.baseUrl;
  return { apiKey, baseUrl };
}

function getEndpoint(model) {
  const which = CONFIG.image.modelEndpoint?.[model] || 'generations';
  return CONFIG.image.endpoints[which];
}

// 从 chat 响应里提取图片 URL (markdown: ![image](url))
function extractChatImageUrl(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const m = content.match(CONFIG.image.chatImagePattern);
  return m ? m[1] : null;
}

function buildBodyGenerations({ prompt, params }) {
  const model = params.model;
  const { size, n, seed, quality, image, ...rest } = params;
  const body = { ...rest, prompt };

  // gpt-image-2 逆向组(gpt-image-2-all)只支持 model/prompt/size/image/quality:
  //   n/seed/response_format 一律忽略, 避免 400
  const isReverse = model === 'gpt-image-2-all';
  if (!isReverse) {
    if (n != null) body.n = Number(n);
    if (seed != null && seed !== 0 && seed !== -1) body.seed = Number(seed);
  }
  if (size) body.size = size;
  if (quality && quality !== 'auto') body.quality = quality;

  // 官方建议显式要求 URL 返回(避免超大 base64, 网页展示友好)
  if (model === 'gpt-image-2') body.response_format = 'url';

  // image 字段: gpt-image-2 官方是数组(支持多图); 其他模型单图字符串
  if (image) {
    body.image = Array.isArray(image) ? image : [image];
  }
  return body;
}

function buildBodyChat({ prompt, params }) {
  // gemini 不需要 size/n/quality 等,只发 messages
  // 未来扩展: 如果 params.image 存在,转成多模态 content [{type:'text',text:prompt},{type:'image_url',image_url:{url}}]
  return {
    model: params.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
}

export async function generateImage({ prompt, params = {}, auth = {} }) {
  const { apiKey, baseUrl } = resolveAuth(auth);
  if (!apiKey) {
    return { ok: false, error: '未配置 API key,请检查 .env 文件或在右上角 API 设置中填写' };
  }
  if (!prompt) {
    return { ok: false, error: 'prompt 不能为空' };
  }

  const model = params.model || CONFIG.image.defaults.model;
  const ep = getEndpoint(model);
  if (!ep) {
    return { ok: false, error: `模型 ${model} 没有配置端点` };
  }

  const isChat = ep === CONFIG.image.endpoints.chat;
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
      // chat 模式 — 从 content markdown 提取
      const url = extractChatImageUrl(data);
      if (!url) {
        return { ok: false, error: 'chat 响应里没找到图片', upstream: data };
      }
      return { ok: true, url, upstream: data };
    }

    // generations 模式 — OpenAI 兼容 (n>1 时返回全部图片)
    const items = data?.data || (Array.isArray(data) ? data : [data]);
    const urls = [], b64s = [];
    for (const it of items) {
      if (it && typeof it.url === 'string') urls.push(it.url);
      if (it && typeof it.b64_json === 'string') b64s.push(it.b64_json);
    }
    // images: 统一数组(优先 url; 否则 b64 data uri), 供前端多图展示
    const images = urls.length ? urls : b64s.map((b) => `data:image/png;base64,${b}`);

    if (!images.length) {
      return { ok: false, error: '上游响应里找不到图片字段', upstream: data };
    }

    return { ok: true, url: urls[0] || null, b64: b64s[0] || null, images, upstream: data };
  } catch (err) {
    return { ok: false, error: `请求失败: ${err.message}` };
  }
}
