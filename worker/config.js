// =====================================================
//  接口配置 — Cloudflare Workers 版
//  API key 从 Workers 环境变量(env)读取, 不再读 .env 文件
//  用法:
//    setEnv(env)  在 fetch handler 里注入 env
//    getConfig()  返回完整配置对象(含 apiKey/baseUrl)
// =====================================================

let ENV = {};

export function setEnv(env) {
  ENV = env || {};
}

export function getConfig() {
  const API_KEY = (ENV.API_KEY || '').trim();
  const BASE_URL = (ENV.BASE_URL || 'https://ai.comfly.org').trim().replace(/\/+$/, '');
  const RH_API_KEY = (ENV.RH_API_KEY || '').trim();

  return {
    // ---------- 基础 ----------
    apiKey: API_KEY,
    baseUrl: BASE_URL,

    // ---------- 文件上传 (comfly) ----------
    upload: {
      endpoint: '/v1/files',
      method: 'POST',
      maxSizeBytes: 20 * 1024 * 1024, // 20MB
    },

    // ---------- 图像生成 ----------
    image: {
      endpoints: {
        generations: { endpoint: '/v1/images/generations', method: 'POST' },
        chat: { endpoint: '/v1/chat/completions', method: 'POST' },
      },
      responseImageFields: ['b64_json', 'url'],
      defaults: {
        model: 'doubao-seedream-5-0-260128',
        size: '1024x1024',
        n: 1,
      },
      modelEndpoint: {
        'doubao-seedream-5-0-260128':     'generations',
        'gpt-image-2':                    'generations',
        'gpt-image-2-all':                'generations',
        'gemini-3.1-flash-lite-image':    'chat',
      },
      chatImagePattern: /!\[image\]\((https?:\/\/[^\s)]+)\)/i,
      paramSchema: [
        { key: 'model', label: '模型', type: 'select', options: [
          'doubao-seedream-5-0-260128',
          'gpt-image-2',
          'gpt-image-2-all',
          'gemini-3.1-flash-lite-image',
        ], default: 'doubao-seedream-5-0-260128' },
        { key: 'size', label: '尺寸', type: 'select', options: [
          'auto', '1024x1024', '1536x1024', '1024x1536',
          '2048x2048', '2048x1152', '1152x2048',
          '3840x2160', '2160x3840',
          '1024x1792', '1792x1024', '864x1152', '1152x864',
        ], default: '1024x1024' },
        { key: 'quality', label: '质量 (gpt-image-2)', type: 'select', options: ['auto', 'low', 'medium', 'high'], default: 'auto', showWhen: { field: 'model', value: 'gpt-image-2' } },
        { key: 'image', label: '参考图 (图生图)', type: 'image', multiple: false, default: '' },
        { key: 'guidance_scale', label: '引导强度 (即梦3)', type: 'number', min: 0, max: 20, default: 5, showWhen: { field: 'model', value: 'doubao-seedream-5-0-260128' } },
        { key: 'watermark', label: '水印 (即梦3)', type: 'select', options: ['true', 'false'], default: 'false', showWhen: { field: 'model', value: 'doubao-seedream-5-0-260128' } },
        { key: 'n', label: '生成数量', type: 'number', min: 1, max: 4, default: 1 },
        { key: 'seed', label: '随机种子', type: 'number', default: -1 },
      ],
    },

    // ---------- 视频生成 ----------
    video: {
      ark: {
        submit: {
          endpoint: '/seedance/v3/contents/generations/tasks',
          method: 'POST',
          defaults: {
            model: 'doubao-seedance-2.5',
            duration: 5,
            ratio: '16:9',
            generate_audio: true,
            watermark: false,
          },
          buildBody: ({ prompt, params }) => {
            const { duration, ratio, generate_audio, watermark, refImage, refImages, ...rest } = params;
            const body = { ...rest };
            body.content = [{ type: 'text', text: prompt }];
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
          taskIdField: 'id',
        },
        status: {
          endpoint: '/seedance/v3/contents/generations/tasks/{taskId}',
          method: 'GET',
          statusField: 'status',
          runningValues: ['queued', 'running', 'in_progress', 'pending', 'submitted'],
          successValues: ['succeeded', 'success', 'completed', 'finished', 'done'],
          failedValues: ['failed', 'cancelled', 'canceled', 'error'],
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

      comfly: {
        submit: {
          endpoint: '/v2/videos/generations',
          method: 'POST',
          defaults: {
            model: 'doubao-seedance-2.5',
            duration: 5,
            size: '1280x720',
          },
          buildBody: ({ prompt, params }) => {
            const { refImage, refImages, ...rest } = params;
            const body = { prompt, ...rest };
            const refs = Array.isArray(refImages) && refImages.length ? refImages : (refImage ? [refImage] : []);
            if (refs.length === 1) body.image_url = refs[0];
            else if (refs.length >= 2) body.images = refs;
            return body;
          },
          taskIdField: 'task_id',
        },
        status: {
          endpoint: '/v2/videos/generations/{taskId}',
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

      defaultFlavor: 'ark',

      serverPoll: {
        maxAttempts: 5,
        intervalMs: 4000,
      },
    },

    // ---------- RunningHub AI App 工作流 (独立服务商) ----------
    runninghub: {
      apiKey: RH_API_KEY,
      baseUrl: 'https://www.runninghub.ai',
      appId: '2085063460288110594',
      instanceType: 'default',
      usePersonalQueue: 'false',
      upload: {
        endpoint: '/openapi/v2/media/upload/binary',
        method: 'POST',
        maxSizeBytes: 50 * 1024 * 1024,
      },
      submit: {
        endpoint: '/openapi/v2/run/ai-app/{appId}',
        method: 'POST',
      },
      query: {
        endpoint: '/openapi/v2/query',
        method: 'POST',
      },
      nodes: {
        ratio:      { nodeId: '115', fieldName: 'aspect_ratio' },
        megapixels: { nodeId: '115', fieldName: 'megapixels', value: '0.8' },
        duration:   { nodeId: '132', fieldName: 'value', value: '15' },
        prompt:     { nodeId: '138', fieldName: 'value' },
        images:     ['137', '139', '142'],
      },
    },

    // 积分价格（与 server/config.js 一致）
    coins: {
      doubaoImage: 5,
      gpt: 15,
      gptAll: 5,
      gemini: 10,
      video: 30,
      runninghub: 30,
    },
  };
}
