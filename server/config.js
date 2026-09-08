// =====================================================
//  接口配置 — 拿到实际文档后只改这一个文件
// =====================================================
//
//  当前适配:  comfly.org (BaseUrl: https://ai.comfly.org)
//
//  视频接口分两组,前端 UI 选哪种走哪种:
//    - 'ark'   : 火山方舟官方格式 (推荐,最稳定)
//    - 'comfly': comfly 自定义兼容格式
//

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 简易 .env 解析(避免引入 dotenv 依赖)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const API_KEY = process.env.API_KEY || '';
const BASE_URL = (process.env.BASE_URL || 'https://ai.comfly.org').replace(/\/+$/, '');
const RH_API_KEY = process.env.RH_API_KEY || '';
const PORT = Number(process.env.PORT) || 3000;

export const CONFIG = {
  // ---------- 基础 ----------
  port: PORT,
  apiKey: API_KEY,
  baseUrl: BASE_URL,

  // ---------- 文件上传 ----------
  // POST {baseUrl}/v1/files (multipart/form-data, field: file)
  // 响应: { id, object, bytes, created_at, filename, url }
  upload: {
    endpoint: `/v1/files`,
    method: 'POST',
    maxSizeBytes: 20 * 1024 * 1024, // 20MB
  },

  // ---------- 图像生成 ----------
  // 多端点 + 多模型:
  //   - generations 端点 (/v1/images/generations): doubao-seedream / gpt-image-2 / gpt-image-2-all
  //   - chat 端点      (/v1/chat/completions):    gemini-3.1-flash-lite-image (返回 markdown 图片)
  image: {
    // 端点表 — 提交时根据 model 自动选
    endpoints: {
      generations: {
        endpoint: `/v1/images/generations`,
        method: 'POST',
      },
      chat: {
        endpoint: `/v1/chat/completions`,
        method: 'POST',
      },
    },
    responseImageFields: ['b64_json', 'url'],
    defaults: {
      model: 'doubao-seedream-3-0-t2i-250415',
      size: '1024x1024',
      n: 1,
    },
    // 每个模型对应哪个端点
    modelEndpoint: {
      'doubao-seedream-3-0-t2i-250415': 'generations',
      'doubao-seedream-4-0-250828':     'generations',
      'gpt-image-2':                    'generations',
      'gpt-image-2-all':                'generations',
      'gemini-3.1-flash-lite-image':    'chat',
    },
    // gemini-chat: markdown 图片正则
    chatImagePattern: /!\[image\]\((https?:\/\/[^\s)]+)\)/i,
    paramSchema: [
      { key: 'model', label: '模型', type: 'select', options: [
        'doubao-seedream-3-0-t2i-250415',
        'doubao-seedream-4-0-250828',
        'gpt-image-2',
        'gpt-image-2-all',
        'gemini-3.1-flash-lite-image',
      ], default: 'doubao-seedream-3-0-t2i-250415' },
      { key: 'size', label: '尺寸', type: 'select', options: [
        // gpt-image-2 官方合法尺寸: 最大边长≤3840 · 16倍数 · 长边:短边≤3:1 · 总像素 655360~8294400
        'auto', '1024x1024', '1536x1024', '1024x1536',
        '2048x2048', '2048x1152', '1152x2048',
        '3840x2160', '2160x3840',
        // 豆包等常用
        '1024x1792', '1792x1024', '864x1152', '1152x864',
      ], default: '1024x1024' },
      { key: 'quality', label: '质量 (gpt-image-2)', type: 'select', options: ['auto', 'low', 'medium', 'high'], default: 'auto', showWhen: { field: 'model', value: 'gpt-image-2' } },
      { key: 'image', label: '参考图 (图生图)', type: 'image', multiple: false, default: '' },
      { key: 'n', label: '数量', type: 'number', min: 1, max: 4, default: 1 },
      { key: 'seed', label: '随机种子', type: 'number', default: -1 },
    ],
  },

  // ---------- 视频生成 ----------
  // 两组接口(提交和查询必须配对用):
  //   ark:    /seedance/v3/contents/generations/tasks  +  /.../{task_id}
  //   comfly: /v2/videos/generations                  +  /v2/videos/generations/{task_id}
  video: {
    // 火山方舟 ARK 官方格式 — content 数组结构
    // 参考 OpenAPI: 顶层 { model, content:[{type,text,...}], ratio?, duration?, generate_audio?, watermark? }
    ark: {
      submit: {
        endpoint: `/seedance/v3/contents/generations/tasks`,
        method: 'POST',
        defaults: {
          model: 'doubao-seedance-2.5',
          duration: 5,
          ratio: '16:9',
          generate_audio: true,
          watermark: false,
        },
        // 适配 ARK 官方: content 数组结构
        // 官方参数: { model, content:[{type,text,image_url:{url},role,...}], generate_audio?, ratio?, duration?, watermark? }
        buildBody: ({ prompt, params }) => {
          const { duration, ratio, generate_audio, watermark, refImage, refImages, ...rest } = params;
          const body = { ...rest };
          // 文本内容
          body.content = [{ type: 'text', text: prompt }];
          // 图生视频: 参考图(可多张)作为 content 后续项 (role: reference_image,首尾帧可传 2 张)
          const refs = Array.isArray(refImages) && refImages.length ? refImages : (refImage ? [refImage] : []);
          refs.forEach((url) => {
            if (url) body.content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
          });
          if (duration != null) body.duration = Number(duration);
          if (ratio) body.ratio = ratio;
          if (generate_audio != null) body.generate_audio = Boolean(generate_audio);
          if (watermark != null) body.watermark = Boolean(watermark);
          return body;
        },
        // 提交后从响应里拿 task_id (响应: { id: "cgt-..." })
        taskIdField: 'id',
      },
      status: {
        endpoint: `/seedance/v3/contents/generations/tasks/{taskId}`,
        method: 'GET',
        // ARK 响应结构: { id, status, content:{...}, created_at, ... }
        statusField: 'status',
        runningValues: ['queued', 'running', 'in_progress', 'pending', 'submitted'],
        successValues: ['succeeded', 'success', 'completed', 'finished', 'done'],
        failedValues: ['failed', 'cancelled', 'canceled', 'error'],
        // ARK 把视频 URL 放在 content.video_url (嵌套对象: content.video_url.url)
        resultFields: ['video_url', 'url', 'b64_json'],
        nestedResultPaths: [
          ['content', 'video_url', 'url'],
          ['content', 'url'],
          ['data', 'video_url', 'url'],
        ],
      },
      paramSchema: [
        { key: 'model', label: '模型', type: 'select', options: [
          'doubao-seedance-2.5',
          'doubao-seedance-2-0-260128',
          'doubao-seedance-2-0-fast-260128',
          'doubao-seedance-2.0-mini',
        ], default: 'doubao-seedance-2.5' },
        { key: 'duration', label: '时长(秒)', type: 'number', min: 1, max: 60, default: 5 },
        { key: 'ratio', label: '比例', type: 'select', options: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], default: '16:9' },
        { key: 'generate_audio', label: '生成音频', type: 'select', options: ['true', 'false'], default: 'true' },
        { key: 'watermark', label: '水印', type: 'select', options: ['false', 'true'], default: 'false' },
      ],

    },

    // comfly 自定义兼容格式 — 扁平 body (Doubao / Wan 共用此端点)
    comfly: {
      submit: {
        endpoint: `/v2/videos/generations`,
        method: 'POST',
        defaults: {
          model: 'doubao-seedance-2.5',
          duration: 5,
          size: '1280x720',
        },
        // 扁平 body — 单图用 image_url,多图(首尾帧)用 images 数组
        buildBody: ({ prompt, params }) => {
          const { refImage, refImages, ...rest } = params;
          const body = { prompt, ...rest };
          const refs = Array.isArray(refImages) && refImages.length ? refImages : (refImage ? [refImage] : []);
          if (refs.length === 1) body.image_url = refs[0];
          else if (refs.length >= 2) body.images = refs;
          return body;
        },
        taskIdField: 'task_id',
        taskIdField: 'task_id',
      },
      status: {
        endpoint: `/v2/videos/generations/{taskId}`,
        method: 'GET',
        statusField: 'status',
        runningValues: ['running', 'processing', 'pending', 'queued', 'in_progress', 'NOT_START', 'IN_PROGRESS', 'PENDING', 'QUEUED', 'RUNNING'],
        successValues: ['succeeded', 'success', 'completed', 'finished', 'SUCCEEDED', 'SUCCESS', 'COMPLETED', 'FINISHED'],
        failedValues: ['failed', 'cancelled', 'canceled', 'error', 'FAILED', 'CANCELLED', 'CANCELED', 'ERROR'],
        resultFields: ['url', 'video_url', 'b64_json', 'data'],
        nestedResultPaths: [],
      },
      paramSchema: [
        { key: 'model', label: '模型', type: 'text', default: 'doubao-seedance-2.5' },
        { key: 'duration', label: '时长(秒)', type: 'select', options: ['5', '10'], default: '5' },
        { key: 'size', label: '尺寸', type: 'select', options: ['1280x720', '720x1280', '960x960', '1024x1024'], default: '1280x720' },
        { key: 'seed', label: '随机种子', type: 'number', default: -1 },
      ],
    },

    // RunningHub AI App 工作流 (独立服务商,独立 Key)
    runninghub: {
      paramSchema: [
        { key: 'model', label: '模型', type: 'select', options: ['runninghub-workflow'], default: 'runninghub-workflow' },
        { key: 'ratio', label: '比例', type: 'select', options: [
          '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
          '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)',
        ], default: '16:9 (Widescreen)' },
      ],
      defaults: { model: 'runninghub-workflow', ratio: '16:9 (Widescreen)' },
    },



    // 前端默认选哪组(可在 UI 切换)
    defaultFlavor: 'ark',

    // 服务端轮询兜底
    serverPoll: {
      maxAttempts: 5,
      intervalMs: 4000,
    },
  },

  // ---------- RunningHub AI App 工作流 (独立服务商) ----------
  // 文档: https://www.runninghub.ai/runninghub-api-doc-en/
  // 鉴权: Bearer <RUNNINGHUB_API_KEY> (独立于 comfly 的 API_KEY)
  runninghub: {
    apiKey: RH_API_KEY,
    baseUrl: 'https://www.runninghub.ai',
    appId: '2085063460288110594',   // AI App 工作流 ID
    instanceType: 'default',         // default (24G) / plus (48G)
    usePersonalQueue: 'false',
    upload: {
      endpoint: '/openapi/v2/media/upload/binary',
      method: 'POST',
      maxSizeBytes: 50 * 1024 * 1024, // 50MB
    },
    submit: {
      endpoint: '/openapi/v2/run/ai-app/{appId}',
      method: 'POST',
    },
    query: {
      endpoint: '/openapi/v2/query',
      method: 'POST',
    },
    // 工作流节点映射 — 按你给的 nodeInfoList 示例
    nodes: {
      ratio:      { nodeId: '115', fieldName: 'aspect_ratio' },
      megapixels: { nodeId: '115', fieldName: 'megapixels', value: '0.8' },
      duration:   { nodeId: '132', fieldName: 'value', value: '15' },
      prompt:     { nodeId: '138', fieldName: 'value' },
      images:     ['137', '139', '142'], // 3 张参考图节点
    },
  },

  // 积分价格（每次生成扣费，登录用户生效）
  coins: {
    doubaoImage: 5,   // 豆包图像
    gpt: 15,          // gpt-image-2 (2k/4k)
    gptAll: 5,        // gpt-image-2-all (逆向 1k)
    gemini: 10,       // gemini 图像
    video: 30,        // doubao-seedance 视频
    runninghub: 30,   // RunningHub 工作流
  },
};

