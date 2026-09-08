// ============== AI 媒体工坊 - 前端逻辑 (goanyai 风格) ==============

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  type: 'image',              // 'image' | 'video' | 'audio'
  model: null,                // 当前选中的模型 id
  flavor: null,               // 视频 flavor (ark/comfly/runninghub)
  refImages: [],              // 参考图 URL 列表 (跨 type 共享)
  rhFiles: {},                // runninghub: { 预览URL: 工作流filename }
  polling: null,
  aborted: false,
  currentTaskId: null,
  currentFlavor: null,
  config: null,               // /api/config 完整响应
  params: {},                  // 底部 pill 行的当前参数(pill 选中时写入)
  provider: 'all',             // 左侧厂商筛选: 'all' | 'doubao' | 'gpt' | 'gemini' | 'rh'
};

// ============== 用户自填 API Key / Base URL (存 localStorage) ==============
const API_SETTINGS_KEY = 'ai_media_api_settings';
function loadApiSettings() {
  try { return JSON.parse(localStorage.getItem(API_SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveApiSettings(s) { localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(s)); }

// ============== 用户登录态 (JWT 存 localStorage, 与夏洛熙共用) ==============
const AUTH_KEY = 'ai_media_auth';
let currentUser = null;
let currentToken = localStorage.getItem(AUTH_KEY) || '';
function saveAuth(token, user) { currentToken = token; currentUser = user; localStorage.setItem(AUTH_KEY, token); }
function clearAuth() { currentToken = ''; currentUser = null; localStorage.removeItem(AUTH_KEY); }
function isLoggedIn() { return !!currentToken; }

// 返回给 fetch 用的 header: API 设置 + 登录 token
function apiAuthHeaders() {
  const s = loadApiSettings();
  const h = {};
  if (s.apiKey) h['x-api-key'] = s.apiKey;
  if (s.baseUrl) h['x-base-url'] = s.baseUrl;
  if (s.rhKey) h['x-rh-key'] = s.rhKey;
  if (currentToken) h['Authorization'] = `Bearer ${currentToken}`;
  return h;
}

// ============== 模型元数据 (UI 展示用) ==============
// 价格/成功率/描述为展示用,真实接口走 /api/config 的 schema
// price 格式: 图像 = 固定次费;视频 = { 480P, 720P, 1080P } 每秒价;音频 = 固定次费
// icon: 真实官方 logo URL (从 wikipedia 抓) / 本地资源 / 内联 SVG
const ICON = {
  doubao:    'https://upload.wikimedia.org/wikipedia/en/f/ff/Doubao_logo.jpg',
  openai:    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/OpenAI_logo_2025_%28symbol%29.svg/250px-OpenAI_logo_2025_%28symbol%29.svg.png',
  openaiSimple: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/OpenAI_logo_2025_%28wordmark%29.svg/250px-OpenAI_logo_2025_%28wordmark%29.svg.png',
  gemini:    iconGemini(), // 官方四色四芒星(内联 SVG,方形)

  volcengine: 'https://upload.wikimedia.org/wikipedia/en/f/ff/Doubao_logo.jpg', // Wan/Seedance 都属字节火山引擎
  runninghub: '/icons/rh-logo.png', // 官网官方 favicon(本地,256x256)
};
const MODEL_META = {
  // ===== 图像 — 按次计费 (金币) =====
  'doubao-seedream-5-0-260128':     { icon: ICON.doubao,       desc: '即梦3 Seedream 5.0',     success: 100, price: { type: 'flat', value: 3 } },
  'gpt-image-2':                    { icon: ICON.openai,       desc: 'GPT Image 2 · 1k/2k/4k', success: 97.1, price: { type: 'flat', value: 2 } },
  'gpt-image-2-all':                { icon: ICON.openai,       desc: 'GPT Image 2 逆向 · 1k',  success: 94.6, price: { type: 'flat', value: 1 } },
  'gemini-3.1-flash-lite-image':    { icon: ICON.gemini,       desc: 'Gemini Flash Lite · 1k', success: 99,   price: { type: 'flat', value: 2 } },
  // ===== 视频 — 按即梦积分表计费 (金币, 1积分=1金币) =====
  'doubao-seedance-2.5':            { icon: ICON.volcengine,   desc: 'Seedance 2.5',           success: 100, price: { type: 'seedance' } },
  'doubao-seedance-2-0-260128':     { icon: ICON.volcengine,   desc: 'Seedance 2.0 Pro',       success: 99,  price: { type: 'seedance' } },
  'doubao-seedance-2-0-fast-260128':{ icon: ICON.volcengine,   desc: 'Seedance 2.0 Fast',      success: 99,  price: { type: 'seedance' } },
  'doubao-seedance-2.0-mini':       { icon: ICON.volcengine,   desc: 'Seedance 2.0 Mini',      success: 98,  price: { type: 'seedance' } },
  'runninghub-workflow':            { icon: ICON.runninghub,   desc: 'RunningHub AI App 工作流', success: 99, price: { type: 'rh' } },
};

// ============== 厂商分组 (左侧筛选) ==============
const PROVIDERS = {
  doubao:  { label: '豆包', icon: ICON.doubao,  isUrl: true },
  gpt:     { label: 'GPT',  icon: ICON.openai,  isUrl: true },
  gemini:  { label: 'Gemini', icon: ICON.gemini, isUrl: false },
  rh:      { label: 'RH',   icon: ICON.runninghub, isUrl: true },
};
function providerOf(id) {
  if (typeof id !== 'string') return 'other';
  if (id.includes('runninghub')) return 'rh';
  if (id.includes('gemini')) return 'gemini';
  if (id.includes('gpt')) return 'gpt';
  if (id.includes('doubao')) return 'doubao';
  return 'other';
}

// ============== 品牌 SVG 图标 (32x32,内联) ==============

// ============== 品牌 SVG 图标 (32x32,内联) ==============

// 豆包 — 橙红渐变圆 + 简笔"豆"轮廓
function iconDoubao() {
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="db" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff7a45"/>
        <stop offset="100%" stop-color="#e23e2a"/>
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="15" fill="url(#db)"/>
    <ellipse cx="13" cy="13" rx="4" ry="3" fill="#fff" opacity="0.4"/>
    <path d="M11 18 q2 4 5 4 q3 0 5-4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="13" cy="14" r="1" fill="#fff"/>
    <circle cx="19" cy="14" r="1" fill="#fff"/>
  </svg>`;
}

// OpenAI 风格 — 黑色螺旋花环 (简化版)
function iconOpenAI(simple) {
  if (simple) {
    // 简化版:实心黑色六角形
    return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z" fill="#000"/>
      <path d="M16 8 L22 11 L22 21 L16 24 L10 21 L10 11 Z" fill="#fff"/>
    </svg>`;
  }
  // 花环:6 片花瓣环绕
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round">
      <circle cx="16" cy="16" r="4"/>
      <path d="M16 4 Q22 8 16 12 Q10 8 16 4"/>
      <path d="M16 28 Q22 24 16 20 Q10 24 16 28"/>
      <path d="M4 16 Q8 10 12 16 Q8 22 4 16"/>
      <path d="M28 16 Q24 10 20 16 Q24 22 28 16"/>
      <path d="M7 7 Q13 9 11 15"/>
      <path d="M25 7 Q19 9 21 15"/>
      <path d="M7 25 Q13 23 11 17"/>
      <path d="M25 25 Q19 23 21 17"/>
    </g>
  </svg>`;
}

// Gemini — 官方四色四芒星 (蓝 #4285F4 / 绿 #34A853 / 黄 #FBBC05 / 红 #EA4335),无 defs 避免 id 冲突
function iconGemini() {
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 3 L20 13 L30 16 L20 19 L16 29 L12 19 L2 16 L12 13 Z" fill="#4285F4"/>
    <path d="M16 3 L20 13 L16 13 L12 13 Z" fill="#34A853"/>
    <path d="M2 16 L12 13 L12 19 Z" fill="#FBBC05"/>
    <path d="M30 16 L20 19 L20 13 Z" fill="#EA4335"/>
    <circle cx="16" cy="16" r="2" fill="#fff"/>
  </svg>`;
}

// Doubao Seedance — 蓝紫渐变 + S 形状
function iconSeedance() {
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sd" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#8b5cf6"/>
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="15" fill="url(#sd)"/>
    <path d="M21 11 Q14 11 14 16 Q14 21 21 21" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M11 11 Q18 11 18 16 Q18 21 11 21" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.4"/>
  </svg>`;
}






// 计算当前选择的预估费用(金币) — 1积分=1金币
// 即梦官方积分表(按模型×分辨率×时长, 线性):
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
// 分辨率选项按模型联动
function seedanceQualityOptions(model) {
  return Object.keys(seedanceRateFor(model));
}
function videoCost(model, quality, secs) {
  const table = seedanceRateFor(model);
  const q = Object.keys(table).includes(quality) ? quality : Object.keys(table)[0];
  const rate = table[q];
  const s = Math.max(1, Number(secs) || 5);
  return rate * s;
}

function calcPrice() {
  const meta = MODEL_META[state.model];
  if (!meta) return { amount: 3, label: '3 金币' };
  // 视频(非 RunningHub): 按即梦积分表(分辨率×时长)
  if (state.type === 'video' && state.model !== 'runninghub-workflow') {
    const q = getCurrentParamValue('quality') || '720P';
    const secs = Number(getCurrentParamValue('duration')) || 5;
    const table = seedanceRateFor(state.model);
    const effQ = Object.keys(table).includes(q) ? q : Object.keys(table)[0];
    const amount = videoCost(state.model, q, secs);
    return { amount, label: `${amount} 金币`, tier: `${effQ} · ${secs}s (${table[effQ]} 金币/秒)` };
  }
  const amount = meta.price.value || 3;
  return { amount, label: `${amount} 金币` };
}

// 从 DOM 读当前参数值(实时,不依赖 localStorage)
function getCurrentParamValue(key) {
  // 优先从 state.params 读(底部 pill 行设置的最新值)
  if (state.params && state.params[key] != null && state.params[key] !== '') return state.params[key];
  const el = document.querySelector(`[data-pkey="${key}"]`);
  if (!el) return null;
  return el.value;
}

// ============== 初始化 ==============
(async function init() {
  bindEvents();
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.config = data;
    renderProviderFilter();
    renderSidebar();
    renderParamsPanel();
  } catch (e) {
    showStatus('无法加载配置: ' + e.message, 'error');
  }
  renderParamsRow(); // 底部参数 pill 行
  startSuggestionCarousel(); // 中央示例提示词轮播
  restoreSession(); // 恢复登录态
})();

// ===== 中央示例提示词（轮播）=====
const SUGGESTIONS = [
  // 图像
  '一张极简风格的App图标，紫蓝渐变',
  '赛博朋克风格的城市街夜景，霓虹灯牌，雨夜倒影',
  '清新自然的产品摄影，白色背景，柔和光影',
  '国风水墨山水画，云雾缭绕，留白意境',
  '3D 卡通渲染的小狐狸，毛绒质感，柔光',
  '梦幻星空下的城堡，银河瀑布，童话氛围',
  '未来科技感智能手表产品图，深色背景，发光细节',
  '油画风格的向日葵田野，梵高笔触，暖色调',
  '可爱柴犬的头像插画，圆润扁平风格，明亮配色',
  '暗黑奇幻风格的巨龙，鳞片细节，火焰吐息',
  '高清微观世界摄影，露珠里的花朵，微距细节',
  '日本浮世绘风格的海浪，葛饰北斋画风',
  '极光下的雪山湖泊，倒影，静谧深邃',
  '蒸汽朋克风格的机械城市，齿轮和管道',
  '极简线条艺术，黑色线条在米白背景，优雅留白',
  // 视频
  '航拍穿越云层的峡谷，晨光洒落，4K 电影感',
  '慢镜头特写：水滴落入水面溅起的涟漪，逆光',
  '一只猫从窗台跃下的慢动作，毛发飘动，暖阳',
  '城市延时摄影：车流如织的十字路口，流光轨迹',
  '海浪拍打礁石的特写慢镜头，水花飞溅，慢动作',
  '春日樱花飘落的长镜头，粉白花瓣随风舞动',
];

let _sugTimer = null;
function startSuggestionCarousel() {
  const box = $('#suggestionChips');
  if (!box) return;
  const renderOnce = () => {
    // 随机取 3 条（不重复）
    const shuffled = [...SUGGESTIONS].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 3);
    box.innerHTML = picked.map((p) =>
      `<button class="chip" data-prompt="${escapeAttr(p)}">${escapeHtml(p)}</button>`
    ).join('');
    // 点击填入 prompt
    box.querySelectorAll('.chip').forEach((c) => {
      c.addEventListener('click', () => {
        const p = $('#prompt');
        if (p) { p.value = c.dataset.prompt; p.focus(); autoResize(p); }
      });
    });
  };
  renderOnce();
  if (_sugTimer) clearInterval(_sugTimer);
  _sugTimer = setInterval(renderOnce, 5000); // 每 5 秒换一批
}

function bindEvents() {
  // ===== API 设置弹窗（仅管理员可见, 按钮默认隐藏）=====
  const apiBtn = $('#openApiBtn');
  if (apiBtn) {
    apiBtn.style.display = 'none';
    apiBtn.addEventListener('click', openApiModal);
  }

  // ===== 用户登录/账户 =====
  const userBtn = $('#userBtn');
  if (userBtn) userBtn.addEventListener('click', () => {
    if (isLoggedIn()) openUserModal();
    else openAuthModal('login');
  });

  // ===== 历史/资产弹窗 =====
  const ohb = $('#openHistoryBtn');
  if (ohb) ohb.addEventListener('click', openHistoryModal);

  // ===== 右侧历史面板:收缩 =====
  const hpc = $('#hpCollapse');
  if (hpc) hpc.addEventListener('click', () => {
    document.body.classList.toggle('rh-collapsed');
    const collapsed = document.body.classList.contains('rh-collapsed');
    // 展开态显示 ❯(提示收起), 收起态显示 ❮(提示展开)
    hpc.textContent = collapsed ? '❮' : '❯';
    hpc.title = collapsed ? '展开' : '收起';
    // 收缩/展开后重新布局(画布会随之变宽)
    if (typeof renderParamsPanel === 'function') renderParamsPanel();
  });

  // 类型 tab
  $$('.type-tab').forEach((t) => {
    t.addEventListener('click', () => switchType(t.dataset.type));
  });
  // 建议 chip
  $$('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      $('#prompt').value = c.dataset.prompt;
      $('#prompt').focus();
    });
  });
  // 发送按钮由 renderParamsRow 动态创建并绑定,这里不重复绑定
  const promptEl = $('#prompt');
  if (promptEl) promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  // 自动调整 textarea 高度
  if (promptEl) promptEl.addEventListener('input', autoResize);
  // prompt 监听 @ 触发资产选择器
  if (promptEl) promptEl.addEventListener('input', onPromptInput);
  // 附件按钮 — 触发文件上传
  const attachEl = $('#attachBtn');
  if (attachEl) attachEl.addEventListener('click', () => {
    triggerFileUpload((url, rhFilename) => {
      if (state.refImages.length < 3) {
        state.refImages.push(url);
        if (rhFilename) state.rhFiles[url] = rhFilename; // runninghub: 记 filename 供提交
        renderAttachments();
      } else {
        showStatus('最多 3 张参考图', 'error');
      }
    });
  });
  // @ 按钮 — 直接打开资产选择器
  const assetPickBtn = $('#assetPickBtn');
  if (assetPickBtn) assetPickBtn.addEventListener('click', () => {
    const items = loadPickerItems();
    if (!items.length) { showStatus('没有可选内容,请先上传附件或添加资产', 'error'); return; }
    const ta = $('#prompt');
    ta.focus();
    const pos = ta.selectionStart || ta.value.length;
    ta.setSelectionRange(pos, pos);
    openAssetPickerDirect(ta);
  });

  // ===== 输入框: 向下收起 / 展开 =====
  const pc = $('#promptCollapse');
  if (pc) pc.addEventListener('click', () => {
    document.body.classList.add('prompt-hidden');
    const exp = $('#promptExpand');
    if (exp) exp.hidden = false;
    showStatus('输入框已收起', 'success');
  });
  const pe = $('#promptExpand');
  if (pe) pe.addEventListener('click', () => {
    document.body.classList.remove('prompt-hidden');
    pe.hidden = true;
    showStatus('输入框已展开', 'success');
  });
}

// 直接打开资产选择器(@ 按钮点击,无真实 @ 字符,光标处直接插入)
function openAssetPickerDirect(ta) {
  openAssetPicker(ta, null);
  const pk = document.getElementById('dynPicker');
  if (pk) {
    const rect = ta.getBoundingClientRect();
    pk.style.left = Math.min(rect.left, window.innerWidth - 360) + 'px';
    pk.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  }
}

function autoResize(e) {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
}

function switchType(type) {
  state.type = type;
  state.model = null;
  state.flavor = null;
  state.provider = 'all';
  $$('.type-tab').forEach((t) => t.classList.toggle('active', t.dataset.type === type));
  renderProviderFilter();
  renderSidebar();
  renderParamsPanel();
  renderParamsRow(); // 同步底部参数 pill 行(关键:之前缺失导致切换无反应)
  updateTopPrice();
  showCanvasEmpty();
  showStatus('', null);
}

// ============== 左侧厂商分组筛选 ==============
function renderProviderFilter() {
  const wrap = $('#providerFilter');
  if (!wrap) return;
  const items = collectModelItems();
  const providers = [...new Set(items.map(m => m.provider))].filter(p => p !== 'other');
  let html = `<button class="filter-btn${state.provider === 'all' ? ' active' : ''}" data-provider="all">全部</button>`;
  providers.forEach(p => {
    const meta = PROVIDERS[p] || { label: p };
    const icon = meta.icon
      ? (meta.isUrl ? `<img class="filter-provider-img" src="${escapeAttr(meta.icon)}" alt="" referrerpolicy="no-referrer"/>` : meta.icon)
      : p;
    html += `<button class="filter-provider${state.provider === p ? ' active' : ''}" data-provider="${p}" title="${escapeAttr(meta.label || p)}">${icon}</button>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('[data-provider]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.provider = btn.dataset.provider;
      renderProviderFilter();
      renderSidebar();
    });
  });
}

// ============== 侧边栏:模型列表 ==============
function renderSidebar() {
  const list = $('#modelList');
  list.innerHTML = '';
  const items = collectModelItems().filter(m => state.provider === 'all' || m.provider === state.provider);
  items.forEach((m) => {
    const meta = MODEL_META[m.id] || { icon: '✦', desc: m.id, success: 99 };
    const price = priceFor(m);
    const div = document.createElement('div');
    div.className = 'model-item' + (state.model === m.id ? ' active' : '');
    div.dataset.id = m.id;
    div.dataset.flavor = m.flavor || '';
    const isUrl = typeof meta.icon === 'string' && (meta.icon.startsWith('http') || meta.icon.startsWith('//') || meta.icon.startsWith('/'));
    const iconHtml = isUrl
      ? `<img class="model-icon-img" src="${escapeAttr(meta.icon)}" alt="" referrerpolicy="no-referrer" />`
      : meta.icon;
    div.innerHTML = `
      <div class="model-icon">${iconHtml}</div>
      <div class="model-info">
        <div class="model-name">${escapeHtml(m.label)}</div>
        <div class="model-desc">${escapeHtml(meta.desc)}</div>
        <div class="model-meta">
          <span class="badge ${successClass(meta.success)}">${meta.success}%</span>
          <span class="badge badge-price">${escapeHtml(price)}</span>
        </div>
      </div>
    `;
    div.addEventListener('click', () => selectModel(m.id, m.flavor));
    list.appendChild(div);
  });
  // 默认选第一个
  if (!state.model && items.length) {
    selectModel(items[0].id, items[0].flavor);
  }
}

function collectModelItems() {
  const out = [];
  if (state.type === 'image') {
    const schema = state.config?.image?.paramSchema?.find(p => p.key === 'model');
    const defaults = state.config?.image?.defaults?.model;
    (schema?.options || []).forEach((m) => {
      out.push({ id: m, label: m, flavor: null, provider: providerOf(m) });
    });
  } else if (state.type === 'video') {
    // 取 ark(即梦官方) + runninghub；跳过 comfly(模型与 ark 重复, 避免 SD2.5 出现两次)
    const flavors = state.config?.video?.flavors || {};
    for (const flv of ['ark', 'runninghub']) {
      const cfg = flavors[flv];
      if (!cfg) continue;
      const modelField = cfg.paramSchema?.find(p => p.key === 'model');
      (modelField?.options || [modelField?.default].filter(Boolean)).forEach((m) => {
        out.push({ id: m, label: m, flavor: flv, provider: providerOf(m) });
      });
    }
  }
  return out;
}

function priceFor(m) {
  // 按卡片自己的模型显示单价(金币) — 1积分=1金币
  const meta = MODEL_META[m.id];
  if (!meta) return '?';
  const p = meta.price;
  if (p.type === 'rh') return '按工作流计费';
  if (p.type === 'per_second') return `${p.value * 10} 金币/秒`;
  if (p.type === 'per_token') return `${p.value * 10} 金币/1M`;
  if (p.type === 'seedance') return '26 金币/秒';
  return `${p.value || 0} 金币`;
}

function updateTopPrice() {
  const el = $('#priceVal');
  if (!el) return;
  const p = calcPrice();
  el.textContent = p.label;
}

function successClass(s) {
  if (s >= 99) return 'badge-success';
  if (s >= 95) return 'badge-warn';
  return 'badge-error';
}

function selectModel(id, flavor) {
  state.model = id;
  state.flavor = flavor;
  $$('.model-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id && (el.dataset.flavor || '') === (flavor || ''));
  });
  renderParamsPanel();
  renderParamsRow(); // 同步底部 pill 行(显示选中的模型名等)
  updateTopPrice();
}

// ============== 右侧参数面板 ==============
function getActiveSchema() {
  if (state.type === 'image') return state.config?.image?.paramSchema || [];
  if (state.type === 'video') return state.config?.video?.flavors?.[state.flavor]?.paramSchema || [];

  return [];
}

function getParamDefaults() {
  if (state.type === 'image') return state.config?.image?.defaults || {};
  if (state.type === 'video') return state.config?.video?.flavors?.[state.flavor]?.defaults || {};

  return {};
}

function getParamKey() {
  return `ai_media_params_${state.type}_${state.flavor || ''}_${state.model || ''}`;
}
// ============== 底部参数 pill 行 (即梦/可灵风格) ==============
// 每次 type/model 切换时调用此函数,重新渲染 pill 行
const PARAMS_ROW_DEFS = {
  video: {
    type:    { label: '视频生成', options: [{v:'image',l:'图像生成'},{v:'video',l:'视频生成'}] },
    model:   { label: '即梦 Seedance 2.5 ✦', options: [
      {v:'doubao-seedance-2.5',l:'即梦 Seedance 2.5 ✦'},
      {v:'doubao-seedance-2-0-260128',l:'Seedance 2.0 Pro'},
      {v:'doubao-seedance-2-0-fast-260128',l:'Seedance 2.0 Fast'},
      {v:'doubao-seedance-2.0-mini',l:'Seedance 2.0 Mini'},
    ] },
    refType: { label: '全部参考 ▼', options: [{v:'none',l:'无参考'},{v:'all',l:'全部参考'},{v:'first_last',l:'首尾帧'},{v:'face',l:'人设参考'}] },
    ratio:   { label: '16:9', ratio: true, options: ['21:9','16:9','4:3','1:1','3:4','9:16'] },
    quality: { label: '720P ✦', options: [{v:'480P',l:'480P'},{v:'720P',l:'720P ✦'},{v:'1080P',l:'1080P ✦'}] },
    count:   { label: '1', type: 'number', options: [1,2,3,4] },
    duration:{ label: '5s', type: 'slider', min: 5, max: 15, step: 1 },
  },
  image: {
    type:    { label: '图像生成', options: [{v:'image',l:'图像生成'},{v:'video',l:'视频生成'}] },
    model:   { label: '即梦3 Seedream 5.0', options: [
      {v:'doubao-seedream-5-0-260128',l:'即梦3 Seedream 5.0'},
      {v:'gpt-image-2',l:'GPT Image 2'},
      {v:'gpt-image-2-all',l:'GPT Image 2 逆向'},
      {v:'gemini-3.1-flash-lite-image',l:'Gemini Flash Lite'},
    ] },
    size:    { label: '1024x1024', options: ['1024x1024','1024x1792','1792x1024','2048x2048'] },
    quality: { label: '质量 auto', options: [{v:'auto',l:'auto'},{v:'low',l:'low'},{v:'medium',l:'medium'},{v:'high',l:'high'}] },
    count:   { label: '1', type: 'number', options: [1,2,3,4] },
  },
  // RunningHub 工作流 (独立 flavor,参数少:比例)
  runninghub: {
    type:    { label: '视频生成', options: [{v:'image',l:'图像生成'},{v:'video',l:'视频生成'}] },
    model:   { label: 'RunningHub 工作流', options: [
      {v:'runninghub-workflow',l:'RunningHub 工作流'},
    ] },
    ratio:   { label: '16:9 (Widescreen)', options: [
      '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
      '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)',
    ] },
  },

};

// gpt-image-2 官方支持的尺寸(见 gpt-best API 文档 api-447261009):
//   最大边长≤3840 · 两边都是16倍数 · 长边:短边≤3:1 · 总像素 655360~8294400
const GPT_IMAGE_2_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840'];
// 其他图像模型(豆包等)常用尺寸
const COMMON_IMAGE_SIZES = ['1024x1024', '1024x1792', '1792x1024', '2048x2048', '864x1152', '1152x864'];

// 按当前模型返回合法 size 选项
function _imageSizeOptions() {
  const m = state.model;
  if (m === 'gpt-image-2') return GPT_IMAGE_2_SIZES;
  if (m === 'gpt-image-2-all') return ['auto', '1024x1024']; // 逆向组仅 1k
  return COMMON_IMAGE_SIZES;
}

// 由尺寸字符串(如 "1536x1024")算出形状比例, 返回缩略矩形的 {w, h}
function _shapeForSize(str) {
  const m = String(str || '').match(/^(\d+)x(\d+)$/i);
  if (!m) return { w: 14, h: 14 }; // auto / 未知 → 方形
  const W = Number(m[1]), H = Number(m[2]);
  const MAX = 18, MIN = 9;
  const ratio = W / H;
  let w, h;
  if (ratio >= 1) { w = MAX; h = Math.max(MIN, Math.round(MAX / ratio)); }
  else { h = MAX; w = Math.max(MIN, Math.round(MAX * ratio)); }
  return { w, h };
}

// 常见宽高比 → 显示文本
const _SIZE_RATIOS = [
  { r: 16 / 9, label: '16:9' },
  { r: 3 / 2,  label: '3:2' },
  { r: 4 / 3,  label: '4:3' },
  { r: 1,      label: '1:1' },
  { r: 3 / 4,  label: '3:4' },
  { r: 2 / 3,  label: '2:3' },
  { r: 9 / 16, label: '9:16' },
];
// 尺寸字符串 → 显示为 "比例 (分辨率档)"，如 "1024x1024" → "1:1 (1k)"
function _sizeLabel(size) {
  if (size === 'auto') return '自动 (auto)';
  const m = String(size || '').match(/^(\d+)x(\d+)$/i);
  if (!m) return String(size);
  const W = Number(m[1]), H = Number(m[2]);
  const ratio = W / H;
  let best = _SIZE_RATIOS[0], bestDiff = Infinity;
  for (const it of _SIZE_RATIOS) {
    const d = Math.abs(it.r - ratio);
    if (d < bestDiff) { bestDiff = d; best = it; }
  }
  const longEdge = Math.max(W, H);
  let k;
  if (longEdge >= 3840) k = '4k';
  else if (longEdge >= 2560) k = '2.5k';
  else if (longEdge >= 2048) k = '2k';
  else if (longEdge >= 1536) k = '1.5k';
  else k = '1k';
  return `${best.label} (${k})`;
}

// 把 schema option [{label, value}] 标准化
function _normOpts(opts) {
  if (!opts) return [];
  return opts.map(o => {
    if (typeof o !== 'object') return { value: o, label: o };
    // 兼容 {v, l} 与 {value, label} 两种写法
    const value = o.value != null ? o.value : o.v;
    const label = o.label != null ? o.label : o.l;
    return { value, label };
  });
}

function renderParamsRow() {
  const row = $('#promptParamsRow');
  if (!row) return;
  row.innerHTML = '';
  const type = state.type || 'video';
  // RunningHub 用独立的参数定义(比例格式不同)
  const defs = (type === 'video' && state.flavor === 'runninghub')
    ? PARAMS_ROW_DEFS.runninghub
    : PARAMS_ROW_DEFS[type];
  if (!defs) return;

  // 当前值
  const saved = JSON.parse(localStorage.getItem('ai_media_params') || '{}');
  const cur = { type, ...saved[type] };

  // 渲染顺序:type / model / refType / ratio / quality / count / duration
  const order = (type === 'video' && state.flavor === 'runninghub')
    ? ['type','model','ratio']
    : (type === 'video'
      ? ['type','model','refType','ratio','quality','count','duration']
      : ['type','model','size','quality','count']);

  order.forEach((key) => {
    let def = defs[key];
    if (!def) return;
    // 图像: 按当前模型动态给 size 选项(gpt-image-2 用官方合法尺寸)
    if (key === 'size' && type === 'image') {
      def = { ...def, options: _imageSizeOptions() };
    }
    // 视频: 分辨率选项按当前模型联动(2.5→480P/720P/1080P; Pro→720P/1080P/4k; mini/Fast→仅720P)
    if (key === 'quality' && type === 'video') {
      const m = state.model || saved[type]?.model || defs.model?.options?.[0]?.v;
      const qs = seedanceQualityOptions(m);
      def = { ...def, options: qs.map((q) => ({ v: q, l: q + (q === '720P' ? ' ✦' : '') })) };
    }
    let val = cur[key] ?? (def.type === 'slider' ? def.min : (type==='video' && key==='quality' ? '720P' : def.options && def.options[0]?.v || def.options?.[0]));
    // 视频分辨率: 已选值不在当前模型选项里时回退到第一个(如 4k → mini 时回退 720P)
    if (key === 'quality' && type === 'video') {
      const opts = _normOpts(def.options).map(o => String(o.value));
      if (!opts.includes(String(val))) val = opts[0] || '720P';
    }
    const pill = document.createElement('button');
    pill.className = 'param-pill';
    pill.dataset.key = key;
    pill.dataset.value = String(val);
    // model pill 显示实际选中的模型名(不是固定 label)
    if (key === 'model') {
      const opt = _normOpts(def.options).find(o => String(o.value) === String(val));
      const star = String(def.label).includes('✦');
      const nm = (opt ? opt.label : String(val)).replace(/[▼✦]/g, '').trim();
      pill.innerHTML = `${nm} <span class="caret">${star ? '✦' : '▾'}</span>`;
    } else if (key === 'size' && type === 'image') {
      // 图像尺寸 pill: 左侧显示当前比例的形状
      const s = _shapeForSize(val);
      pill.innerHTML = `<span class="ratio-icon" style="width:${s.w}px;height:${s.h}px;margin-right:5px;vertical-align:middle"></span>${_pillLabel(def, val, key)}`;
    } else {
      pill.innerHTML = _pillLabel(def, val, key);
    }
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      _openParamPopover(pill, key, def, type);
    });
    row.appendChild(pill);
  });


  // 价格(只读)
  const price = document.createElement('span');
  price.className = 'param-pill price-pill';
  price.id = 'pricePill';
  price.textContent = '— 金币';
  row.appendChild(price);

  // 发送按钮
  const send = document.createElement('button');
  send.id = 'sendBtn';
  send.className = 'send-btn';
  send.title = '生成';
  send.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  send.addEventListener('click', handleSend);
  row.appendChild(send);

  // 同步价格(用 calcPrice,从 state.params + 右侧 DOM 读)
  const p = calcPrice();
  price.textContent = p.label;
  price.title = p.tier || '';
}

function _pillLabel(def, val, key) {
  // 比例(视频): 显示选中值
  if (def.ratio) return `${val} <span class="caret">▾</span>`;
  // 生成数量: 显示"生成数量 N"(N=一次出几张图, 与参考图数量无关)
  if (def.type === 'number') return `生成数量 ${val} <span class="caret">▾</span>`;
  // 时长滑块: 显示"时长 Ns"
  if (def.type === 'slider') return `时长 ${val}s <span class="caret">▾</span>`;
  if (def.text) return `${val} <span class="caret">▾</span>`;
  // 尺寸: 显示为 "比例 (k)" 形式, 如 1:1 (1k)
  if (key === 'size') return `${_sizeLabel(val)} <span class="caret">▾</span>`;
  // 质量: 显示"质量 xxx"
  if (key === 'quality') return `质量 ${val} <span class="caret">▾</span>`;
  // 其他: 显示选中选项的 label, 而非固定 def.label
  const opt = _normOpts(def.options).find(o => String(o.value) === String(val));
  const show = opt ? opt.label : val;
  const star = String(def.label).includes('✦') && !String(show).includes('✦');
  return `${show} <span class="caret">${star ? '✦' : '▾'}</span>`;
}

// 通用上拉选择弹窗(点击 pill 在它上方弹出,带遮罩)
function _openParamPopover(anchorEl, key, def, type) {
  closePopover();
  const mask = document.createElement('div');
  mask.className = 'popover-mask';
  mask.addEventListener('click', closePopover);
  document.body.appendChild(mask);

  const panel = document.createElement('div');
  panel.className = 'popover-panel';
  panel.innerHTML = `<div class="popover-title">选择${_popoverTitle(key)}</div><div class="popover-options" id="popoverOpts"></div>`;
  const optsWrap = panel.querySelector('#popoverOpts');
  const opts = _normOpts(def.options);
  const cur = anchorEl.dataset.value;
  if (def.type === 'slider') {
    // 滑块选择: min ~ max(默认 5~15)
    const min = def.min != null ? Number(def.min) : 5;
    const max = def.max != null ? Number(def.max) : 15;
    const step = def.step != null ? Number(def.step) : 1;
    const start = Math.min(Math.max(Number(cur) || min, min), max);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 0';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min); range.max = String(max); range.step = String(step);
    range.value = String(start);
    range.style.cssText = 'flex:1;accent-color:var(--primary)';
    const valLabel = document.createElement('span');
    valLabel.style.cssText = 'font-size:14px;font-weight:700;min-width:38px;text-align:center;color:var(--primary)';
    valLabel.textContent = start + 's';
    range.addEventListener('input', () => { valLabel.textContent = range.value + 's'; });
    const ok = document.createElement('button');
    ok.className = 'popover-option';
    ok.style.cssText = 'margin-top:6px;background:var(--primary);color:#fff';
    ok.textContent = '确定';
    ok.addEventListener('click', () => {
      const v = Number(range.value);
      state.params[key] = v;
      const all = JSON.parse(localStorage.getItem('ai_media_params') || '{}');
      all[type] = { ...(all[type]||{}), [key]: v };
      localStorage.setItem('ai_media_params', JSON.stringify(all));
      closePopover();
      renderParamsRow();
      renderParamsPanel();
      updateTopPrice();
      document.querySelectorAll('.type-tab').forEach(t => t.classList.toggle('active', t.dataset.type === state.type));
      document.querySelectorAll('.model-item').forEach(m => m.classList.toggle('active', m.dataset.id === state.model && (m.dataset.flavor || '') === (state.flavor || '')));
    });
    row.appendChild(range);
    row.appendChild(valLabel);
    optsWrap.appendChild(row);
    optsWrap.appendChild(ok);
  } else {
    opts.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'popover-option' + (o.value == cur ? ' selected' : '');
      if (def.ratio) {
        const w = o.value === '21:9' ? 18 : o.value === '16:9' ? 14 : o.value === '4:3' ? 13 : o.value === '1:1' ? 12 : o.value === '3:4' ? 10 : 10;
        const h = o.value === '21:9' ? 7 : o.value === '16:9' ? 9 : o.value === '4:3' ? 10 : o.value === '1:1' ? 12 : o.value === '3:4' ? 13 : 16;
        b.innerHTML = `<span class="ratio-icon" style="width:${w}px;height:${h}px"></span><span>${o.value}</span>`;
      } else if (key === 'size' && type === 'image') {
        // 图像尺寸: 每个选项旁显示对应比例的形状 + "比例 (k)" 文本
        const s = _shapeForSize(o.value);
        b.innerHTML = `<span class="ratio-icon" style="width:${s.w}px;height:${s.h}px"></span><span>${_sizeLabel(o.value)}</span>`;
      } else if (def.options && typeof o.label === 'string' && o.label.includes('✦')) {
        b.innerHTML = `<span>${o.value}</span><span class="star">✦</span>`;
      } else {
        b.textContent = o.label || o.value;
      }
      b.addEventListener('click', () => {
        state.params[key] = o.value;
        const all = JSON.parse(localStorage.getItem('ai_media_params') || '{}');
        all[type] = { ...(all[type]||{}), [key]: o.value };
        localStorage.setItem('ai_media_params', JSON.stringify(all));
        if (key === 'type') state.type = o.value;
        if (key === 'model') {
          state.model = o.value;
          // 视频模型默认走 ark flavor（即梦官方格式），RunningHub 除外
          if (state.type === 'video' && o.value !== 'runninghub-workflow') state.flavor = 'ark';
        }
        closePopover();
        renderParamsRow();
        renderParamsPanel();
        updateTopPrice();
        document.querySelectorAll('.type-tab').forEach(t => t.classList.toggle('active', t.dataset.type === state.type));
        document.querySelectorAll('.model-item').forEach(m => m.classList.toggle('active', m.dataset.id === state.model && (m.dataset.flavor || '') === (state.flavor || '')));
      });
      optsWrap.appendChild(b);
    });
  }
  document.body.appendChild(panel);

  // 定位:在 anchor 上方居中
  const rect = anchorEl.getBoundingClientRect();
  const pw = panel.offsetWidth;
  let left = rect.left + rect.width / 2 - pw / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
  panel.style.left = left + 'px';
  panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
}

function _popoverTitle(key) {
  return ({ type: '类型', model: '模型', refType: '参考类型', ratio: '比例', quality: '分辨率', count: '数量', duration: '时长(s)', size: '尺寸', mv: '模型版本', tags: '风格标签' }[key]) || key;
}
function closePopover() {
  document.querySelectorAll('.popover-mask, .popover-panel').forEach(n => n.remove());
}

function renderParamsPanel() {
  const wrap = $('#paramsContent');
  if (!wrap) return;
  const list = loadHistory().filter(h => h.type === state.type).slice(0, 60);
  if (!list.length) {
    wrap.innerHTML = '<div class="history-panel-empty">暂无历史记录<br><span>生成的内容会显示在这里</span></div>';
    updateTopPrice();
    return;
  }
  wrap.innerHTML =
    '<div class="history-panel-list">' +
    list.map((h, i) => {
      let media = '';
      if (h.type === 'image') media = `<img src="${escapeAttr(h.src)}" alt="" />`;
      else if (h.type === 'video') media = `<video src="${escapeAttr(h.src)}" muted></video>`;
      else media = '<div class="history-panel-audio">🎵</div>';
      const inAssets = isAsseted(h.src);
      return `<div class="history-panel-item" data-idx="${i}">
        <div class="history-panel-thumb">${media}</div>
        <div class="history-panel-info">
          <div class="history-panel-prompt" title="${escapeAttr(h.prompt || '')}">${escapeHtml((h.prompt || '暂无描述').slice(0, 20))}</div>
          <div class="history-panel-actions">
            <button class="hp-star${inAssets ? ' added' : ''}" title="${inAssets ? '已在资产' : '加入资产'}">${inAssets ? '★' : '+'}</button>
            <button class="hp-del" title="删除">×</button>
          </div>
        </div>
      </div>`;
    }).join('') +
    '</div>';
  // 绑定事件
  wrap.querySelectorAll('.history-panel-item').forEach(el => {
    const i = Number(el.dataset.idx);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.hp-del') || e.target.closest('.hp-star')) return;
      loadFromHistory(list[i]);
    });
    el.querySelector('.hp-del').addEventListener('click', (e) => {
      e.stopPropagation();
      const all = loadHistory();
      all.splice(i, 1);
      saveHistoryList(all);
      renderParamsPanel();
    });
    el.querySelector('.hp-star').addEventListener('click', (e) => {
      e.stopPropagation();
      addCurrentToAssets(list[i], e.target.closest('.hp-star'));
      renderParamsPanel();
    });
  });
  updateTopPrice();
}

function needsRefImages() {
  if (state.type === 'image') return true;
  return false;
}

function renderParamGroup(p, value, lsKey, schema) {
  const group = document.createElement('div');
  group.className = 'param-group';
  const label = document.createElement('div');
  label.className = 'param-group-label';
  label.textContent = p.label;
  group.appendChild(label);

  if (p.type === 'select') {
    const opts = document.createElement('div');
    opts.className = 'param-options';
    p.options.forEach((o) => {
      // 支持 [{label, value}] 或纯字符串
      const value_ = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : o;
      const pill = document.createElement('button');
      pill.className = 'param-pill' + (value_ == value ? ' active' : '');
      pill.textContent = label;
      pill.dataset.value = value_;
      pill.addEventListener('click', () => {
        opts.querySelectorAll('.param-pill').forEach(x => x.classList.remove('active'));
        pill.classList.add('active');
        const all = JSON.parse(localStorage.getItem('ai_media_params') || '{}');
        all[state.type] = { ...(all[state.type] || {}), [p.key]: value_ };
        localStorage.setItem('ai_media_params', JSON.stringify(all));
        updateTopPrice();
        if (p.showWhen || p.key === 'mode') renderParamsPanel();
      });
      opts.appendChild(pill);
    });
    group.appendChild(opts);
  } else if (p.type === 'number') {
    const row = document.createElement('div');
    row.className = 'param-row';
    const input = document.createElement('input');
    input.type = 'number';
    if (p.min != null) input.min = p.min;
    if (p.max != null) input.max = p.max;
    input.value = value;
    input.addEventListener('change', () => {
      const all = JSON.parse(localStorage.getItem('ai_media_params') || '{}');
      all[state.type] = { ...(all[state.type] || {}), [p.key]: Number(input.value) };
      localStorage.setItem('ai_media_params', JSON.stringify(all));
      updateTopPrice();
    });
    row.appendChild(input);
    group.appendChild(row);
  } else if (p.type === 'text') {
    const row = document.createElement('div');
    row.className = 'param-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = p.label;
    input.addEventListener('change', () => {
      const all = JSON.parse(localStorage.getItem('ai_media_params') || '{}');
      all[state.type] = { ...(all[state.type] || {}), [p.key]: input.value };
      localStorage.setItem('ai_media_params', JSON.stringify(all));
      updateTopPrice();
    });
    row.appendChild(input);
    group.appendChild(row);
  }

  return group;
}

function renderRefImagesGroup() {  const group = document.createElement('div');
  group.className = 'param-group';
  group.innerHTML = `
    <div class="param-group-label">参考图 <span class="ref-limit" style="float:right">${state.refImages.length}/3</span></div>
    <div style="font-size:11px;color:var(--text-dim);padding:6px 0">
      点击底部输入框左侧的 <strong>📎 按钮</strong> 添加参考图
      <br>· 支持 jpg/png/webp,最大 20MB
      <br>· 添加后底部会出现缩略图
    </div>
  `;
  return group;
}

function triggerFileUpload(onUploaded, multiple = false) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (multiple) input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // RunningHub flavor 走独立上传端点,返回 filename 供工作流引用
    const isRh = state.flavor === 'runninghub';
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      try {
        const r = await fetch(isRh ? '/api/rh-upload' : '/api/upload', { method: 'POST', headers: { ...apiAuthHeaders() }, body: fd });
        const d = await r.json();
        if (d.ok) {
          if (isRh) {
            // d: { url(预览), filename(工作流引用) }
            onUploaded(d.url, d.filename);
          } else {
            onUploaded(d.url);
          }
        } else showStatus('上传失败: ' + d.error, 'error');
      } catch (err) {
        showStatus('上传错误: ' + err.message, 'error');
      }
    }
  };
  input.click();
}

function renderAttachments() {
  const wrap = $('#promptAttachments');
  if (!state.refImages.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = state.refImages.map((u, i) => `
    <div class="attach-thumb">
      <img src="${escapeAttr(u)}" alt="" />
      <button class="attach-remove" data-idx="${i}">×</button>
    </div>
  `).join('');
  wrap.querySelectorAll('.attach-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      state.refImages.splice(i, 1);
      renderAttachments();
    });
  });
}

// ============== 画布 ==============
function showCanvasEmpty() {
  $('#canvasEmpty').hidden = false;
  $('#canvasResult').hidden = true;
  $('#canvasResult').innerHTML = '';
}
function showCanvasResult(html) {
  $('#canvasEmpty').hidden = true;
  $('#canvasResult').hidden = false;
  $('#canvasResult').innerHTML = html;
}
function showCanvasLoading(text) {
  $('#canvasEmpty').hidden = true;
  $('#canvasResult').hidden = false;
  $('#canvasResult').innerHTML = `
    <div class="canvas-loading">
      <div class="spinner"></div>
      <div>${escapeHtml(text || '生成中...')}</div>
    </div>
  `;
}

// ============== 发送 ==============
async function handleSend() {
  // 未登录拦截: 生成需要登录(积分扣费)
  if (!isLoggedIn()) {
    showStatus('请先登录后再生成', 'error');
    openAuthModal('login');
    return;
  }
  let prompt = $('#prompt').value;
  if (!prompt.trim()) { showStatus('请输入描述', 'error'); return; }
  if (!state.model) { showStatus('请先选择模型', 'error'); return; }

  // 解析 @ 资产引用 → 替换成实际 URL 并塞到 refImages
  prompt = resolveAssetRefs(prompt);
  $('#prompt').value = prompt;
  if (!prompt.trim()) { showStatus('资产已附加,请继续输入描述', 'error'); return; }

  state.aborted = false;
  setBusy(true);
  showCanvasLoading('生成中,请稍候...');

  const params = collectParams();

  // 生成数量提示: n>1 时明确告知将出几张图(避免误扣)
  if (state.type === 'image' && Number(params.n) > 1) {
    const per = calcPrice().amount || 5;
    showStatus(`将生成 ${params.n} 张图, 共 ${per * params.n} 金币`, 'success');
  }

  try {
    if (state.type === 'image') await runImage(prompt, params);
    else if (state.type === 'video') await runVideo(prompt, params);
  } catch (e) {
    showStatus('请求失败: ' + e.message, 'error');
    showCanvasEmpty();
  } finally {
    setBusy(false);
  }
}

function collectParams() {
  const schema = getActiveSchema();
  // 与 pill 行/右侧面板共用同一存储: ai_media_params[type]
  const saved = JSON.parse(localStorage.getItem('ai_media_params') || '{}')[state.type] || {};
  const params = { model: state.model };
  schema.forEach((p) => {
    if (p.key === 'model') return;
    const v = saved[p.key] ?? p.default ?? '';
    if (v === '' || v == null) return;
    if (p.type === 'select' && (v === 'true' || v === 'false')) {
      params[p.key] = v === 'true';
    } else {
      params[p.key] = v;
    }
  });
  // seed 0/-1 视为未设
  if (params.seed === 0 || params.seed == null || params.seed === -1) delete params.seed;
  // 参考图 — 写到约定字段 (图像→image, 视频→refImages 多参考)
  if (state.refImages.length) {
    if (state.type === 'image') {
      // gpt-image-2 官方 image 是数组(支持多图参考); 其他模型传单图
      params.image = (state.model === 'gpt-image-2')
        ? state.refImages.slice(0, 4)
        : state.refImages[0];
    } else if (state.type === 'video') {
      // runninghub: 传 RunningHub 上传返回的 filename(工作流 LoadImage 节点引用)
      params.refImages = state.flavor === 'runninghub'
        ? state.refImages.map(u => state.rhFiles[u] || u)
        : state.refImages;
    }
  }
  return params;
}

function setBusy(busy) {
  $('#sendBtn').disabled = busy;
  $$('.model-item').forEach(el => el.style.pointerEvents = busy ? 'none' : '');
  $$('.type-tab').forEach(el => el.disabled = busy);
  $$('.param-pill, input, textarea, .ref-add').forEach(el => {
    if (el) el.style.pointerEvents = busy ? 'none' : '';
  });
}

// ============== 图像 ==============
async function runImage(prompt, params) {
  const res = await fetch('/api/generate-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: JSON.stringify({ prompt, params }),
  });
  const d = await res.json();
  if (!d.ok) { showStatus(d.error || '生成失败', 'error'); showCanvasEmpty(); return; }
  // n>1 时后端返回 images 数组, 前端网格展示全部
  const srcs = (d.images && d.images.length)
    ? d.images
    : (d.url ? [d.url] : (d.b64 ? [`data:image/png;base64,${d.b64}`] : []));
  if (!srcs.length) { showStatus('响应里没图片', 'error'); showCanvasEmpty(); return; }
  const html = srcs.map(s => `<img src="${escapeAttr(s)}" alt="生成结果" />`).join('');
  showCanvasResult(`<div class="result-grid">${html}</div>`);
  saveHistory({ type: 'image', model: state.model, prompt, params, refImages: [...state.refImages], src: srcs[0], images: srcs });
  showStatus('生成完成', 'success');
}

// ============== 视频 ==============
async function runVideo(prompt, params) {
  const res = await fetch('/api/generate-video', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: JSON.stringify({ prompt, params, flavor: state.flavor }),
  });
  const d = await res.json();
  if (!d.ok) { showStatus(d.error || '提交失败', 'error'); showCanvasEmpty(); return; }
  if (d.status === 'succeeded' && (d.url || d.b64)) {
    showCanvasResult(`<video src="${escapeAttr(d.url || 'data:video/mp4;base64,' + d.b64)}" controls autoplay loop></video>`);
    saveHistory({ type: 'video', model: state.model, flavor: state.flavor, prompt, params, refImages: [...state.refImages], src: d.url || ('data:video/mp4;base64,' + d.b64) });
    showStatus('生成完成', 'success');
    return;
  }
  if (d.taskId) {
    state.currentTaskId = d.taskId;
    state.currentFlavor = d.flavor || state.flavor;
    const result = await pollVideo(d.taskId, state.currentFlavor);
    if (state.aborted) return;
    if (result.ok && (result.url || result.b64)) {
      const vSrc = result.url || 'data:video/mp4;base64,' + result.b64;
      showCanvasResult(`<video src="${escapeAttr(vSrc)}" controls autoplay loop></video>`);
      saveHistory({ type: 'video', model: state.model, flavor: state.currentFlavor, prompt, params, refImages: [...state.refImages], src: vSrc });
      showStatus('生成完成', 'success');
    } else {
      showStatus(result.error || '视频生成失败', 'error');
      showCanvasEmpty();
    }
  } else {
    showStatus('未返回 task_id', 'error');
    showCanvasEmpty();
  }
}

function pollVideo(taskId, flavor) {
  return new Promise((resolve) => {
    let attempts = 0;
    const max = 45;
    const tick = async () => {
      if (state.aborted) { clearInterval(state.polling); state.polling = null; return resolve({ ok: false, error: '已取消' }); }
      attempts++;
      try {
        const r = await fetch(`/api/video-status/${encodeURIComponent(taskId)}?flavor=${encodeURIComponent(flavor)}`, { headers: { ...apiAuthHeaders() } });
        const d = await r.json();
        if (d.ok && d.status === 'succeeded') { clearInterval(state.polling); state.polling = null; return resolve({ ok: true, url: d.url, b64: d.b64 }); }
        if (d.ok && d.status === 'running') {
          showCanvasLoading(`视频生成中 (${attempts}/${max})...`);
          if (attempts >= max) { clearInterval(state.polling); state.polling = null; return resolve({ ok: false, error: '轮询超时' }); }
        } else { clearInterval(state.polling); state.polling = null; return resolve({ ok: false, error: d.error || '生成失败' }); }
      } catch (e) { clearInterval(state.polling); state.polling = null; return resolve({ ok: false, error: e.message }); }
    };
    state.polling = setInterval(tick, 4000);
    tick();
  });
}



// ============== 工具 ==============
function showStatus(text, kind) {
  const el = $('#status');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  el.className = 'status-toast' + (kind ? ' ' + kind : '');
  if (kind === 'success') {
    setTimeout(() => { el.hidden = true; }, 2500);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ============== 历史记录 ==============
const HISTORY_KEY = 'ai_media_history';
const HISTORY_MAX = 50;

function saveHistory(item) {
  const list = loadHistory();
  list.unshift({ ...item, ts: Date.now() });
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function typeLabel(t) {
  if (t === 'image') return '图像';
  if (t === 'video') return '视频';
  return t;
}

// (旧 renderHistory / 旧 loadFromHistory 已删除 — 由下面 JS 动态弹窗实现替代)

const ASSETS_KEY = 'ai_media_assets';
const ASSETS_MAX = 200;

let hmState = {
  main: 'history',     // history | assets
  type: 'all',         // all | image | video | audio
  search: '',
  batch: false,
  selected: new Set(), // 选中的 id 集合
};

function loadAssets() {
  try { return JSON.parse(localStorage.getItem(ASSETS_KEY) || '[]'); }
  catch { return []; }
}
function saveAssets(list) { localStorage.setItem(ASSETS_KEY, JSON.stringify(list)); }
function addAsset(item) {
  const list = loadAssets();
  if (list.some(a => a.src === item.src)) return false;
  list.unshift({ id: 'a-' + Date.now() + '-' + Math.floor(Math.random() * 1000), addedAt: Date.now(), ...item });
  if (list.length > ASSETS_MAX) list.length = ASSETS_MAX;
  saveAssets(list);
  return true;
}
function removeAsset(id) {
  saveAssets(loadAssets().filter(a => a.id !== id));
}
function isAsseted(src) {
  return loadAssets().some(a => a.src === src);
}

// ============== 历史/资产库 (JS 动态创建弹窗) ==============
// 弹窗 DOM 完全由 JS 生成 + 内联样式,不依赖 HTML 静态元素,避免缓存导致元素缺失

// 注入弹窗所需 CSS(一次性)
function ensureModalCss() {
  if (document.getElementById('dynModalCss')) return;
  const css = `
#dynOverlay{position:fixed;inset:0;background:rgba(4,4,14,.5);z-index:9990;display:flex;align-items:center;justify-content:center;animation:dynFade .15s}
@keyframes dynFade{from{opacity:0}to{opacity:1}}
.dyn-modal{background:linear-gradient(160deg,rgba(30,36,66,.88),rgba(20,24,48,.82));border-radius:16px;box-shadow:0 24px 70px rgba(4,4,20,.6),inset 0 1px 0 rgba(255,255,255,.06);width:92vw;max-width:1200px;height:86vh;display:flex;flex-direction:column;overflow:hidden;animation:dynUp .18s;border:1px solid rgba(140,150,220,.2)}
@keyframes dynUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.dyn-top{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid rgba(140,150,220,.14);flex-shrink:0}
.dyn-tabs{display:flex;gap:6px}
.dyn-tab{background:transparent;border:none;padding:8px 16px;font-size:15px;color:#a5b0d6;cursor:pointer;border-radius:8px;font-weight:500;transition:all .15s}
.dyn-tab:hover{color:#eef2ff;background:rgba(140,150,220,.12)}
.dyn-tab.active{background:rgba(138,92,245,.24);color:#fff;font-weight:600;box-shadow:inset 0 0 0 1px rgba(138,92,245,.5)}
.dyn-tabs-right{display:flex;gap:8px;align-items:center}
.dyn-search{display:flex;align-items:center;background:rgba(16,20,40,.55);border:1px solid rgba(140,150,220,.16);border-radius:8px;padding:0 10px;height:34px;color:#7c87ad}
.dyn-search input{background:transparent;border:none;outline:none;font-size:13px;margin-left:6px;width:150px;color:#eef2ff}
.dyn-search input::placeholder{color:#7c87ad}
.dyn-btn{background:rgba(30,36,66,.6);border:1px solid rgba(140,150,220,.2);padding:6px 12px;font-size:13px;color:#c9d2f0;border-radius:8px;cursor:pointer;transition:all .15s}
.dyn-btn:hover{background:rgba(138,92,245,.25);border-color:rgba(138,92,245,.5);color:#fff}
.dyn-btn.danger{color:#ff8a9c;border-color:rgba(255,107,129,.35)}
.dyn-btn.danger:hover{background:rgba(255,107,129,.15)}
.dyn-sub{display:flex;align-items:center;gap:4px;padding:0 20px;border-bottom:1px solid rgba(140,150,220,.14);flex-shrink:0;height:44px}
.dyn-sub-tab{background:transparent;border:none;padding:6px 14px;font-size:14px;color:#a5b0d6;cursor:pointer;border-radius:6px;transition:all .15s}
.dyn-sub-tab:hover{color:#eef2ff}
.dyn-sub-tab.active{color:#fff;font-weight:600;background:rgba(138,92,245,.2)}
.dyn-body{flex:1;overflow-y:auto;padding:20px 26px;background:rgba(12,16,32,.35)}
.dyn-day{font-size:18px;font-weight:600;color:#eef2ff;margin:8px 0 12px}
.dyn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:24px}
.dyn-card{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;background:rgba(24,28,52,.7);border:2px solid transparent;transition:transform .15s,box-shadow .15s}
.dyn-card:hover{transform:scale(1.04);box-shadow:0 6px 18px rgba(0,0,0,.3);z-index:2}
.dyn-card.selected{border-color:#8a5cf5}
.dyn-card img,.dyn-card video{width:100%;height:100%;object-fit:cover;display:block}

.dyn-badge{position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px}
.dyn-star{position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;background:rgba(138,92,245,.9);color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;opacity:0;transition:opacity .15s}
.dyn-card:hover .dyn-star{opacity:1}
.dyn-star.added{background:#3ee6a7;opacity:1}
.dyn-empty{text-align:center;color:#7c87ad;padding:60px 20px;font-size:14px}
.dyn-check{position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.95);border:2px solid #8a5cf5;display:none;align-items:center;justify-content:center;font-size:12px;color:#fff}
.dyn-batching .dyn-check{display:flex}
.dyn-card.selected .dyn-check{background:#8a5cf5;border-color:#8a5cf5}
.dyn-close{background:rgba(30,36,66,.6);border:1px solid rgba(140,150,220,.2);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;color:#a5b0d6;transition:all .15s}
.dyn-close:hover{background:rgba(138,92,245,.25);color:#fff}
`;
  const st = document.createElement('style');
  st.id = 'dynModalCss';
  st.textContent = css;
  document.head.appendChild(st);
}

function openHistoryModal() {
  ensureModalCss();
  // 移除旧的
  const old = document.getElementById('dynOverlay');
  if (old) old.remove();
  hmState = { main: 'history', type: 'all', search: '', batch: false, selected: new Set() };

  const overlay = document.createElement('div');
  overlay.id = 'dynOverlay';
  overlay.innerHTML = `
    <div class="dyn-modal">
      <div class="dyn-top">
        <div class="dyn-tabs">
          <button class="dyn-tab active" data-main="history">生成历史</button>
          <button class="dyn-tab" data-main="assets">资产库</button>
        </div>
        <div class="dyn-tabs-right">
          <div class="dyn-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="dynHmSearch" placeholder="搜索" />
          </div>
          <button class="dyn-btn" id="dynHmBatch">批量操作</button>
          <button class="dyn-btn danger" id="dynHmDelete" style="display:none">删除所选(<span id="dynSelCount">0</span>)</button>
          <button class="dyn-close" id="dynHmClose">✕</button>
        </div>
      </div>
      <div class="dyn-sub" id="dynHmSub"></div>
      <div class="dyn-body" id="dynHmBody"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHistoryModal(); });
  $('#dynHmClose').addEventListener('click', closeHistoryModal);
  $('#dynHmSearch').addEventListener('input', () => { hmState.search = $('#dynHmSearch').value; renderHmBody(); });
  $('#dynHmBatch').addEventListener('click', () => { hmState.batch = !hmState.batch; hmState.selected.clear(); overlay.classList.toggle('dyn-batching', hmState.batch); $('#dynHmDelete').style.display = hmState.batch ? '' : 'none'; renderHmBody(); });
  $('#dynHmDelete').addEventListener('click', deleteSelected);
  // 主 Tab
  overlay.querySelectorAll('.dyn-tab').forEach(t => t.addEventListener('click', () => switchHmMain(t.dataset.main)));
  renderHmSub();
  renderHmBody();
}
function closeHistoryModal() {
  const o = document.getElementById('dynOverlay');
  if (o) o.remove();
}
function switchHmMain(main) {
  hmState.main = main;
  hmState.type = 'all';
  hmState.selected.clear();
  const ov = document.getElementById('dynOverlay');
  if (ov) ov.querySelectorAll('.dyn-tab').forEach(t => t.classList.toggle('active', t.dataset.main === main));
  renderHmSub();
  renderHmBody();
}
function renderHmSub() {
  const sub = $('#dynHmSub');
  if (!sub) return;
  const tabs = [
    { t: 'all', l: '全部' }, { t: 'image', l: '图片' }, { t: 'video', l: '视频' },
  ].map(x => `<button class="dyn-sub-tab${hmState.type === x.t ? ' active' : ''}" data-type="${x.t}">${x.l}</button>`).join('');
  sub.innerHTML = tabs;
  sub.querySelectorAll('.dyn-sub-tab').forEach(t => t.addEventListener('click', () => switchHmType(t.dataset.type)));
}
function switchHmType(type) {
  hmState.type = type;
  hmState.selected.clear();
  renderHmSub();
  renderHmBody();
}
function updateHmSelectedCount() { const el = $('#dynSelCount'); if (el) el.textContent = String(hmState.selected.size); }
function deleteSelected() {
  if (hmState.selected.size === 0) return;
  if (!confirm(`确认删除选中的 ${hmState.selected.size} 项?`)) return;
  const ids = hmState.selected;
  if (hmState.main === 'history') {
    const list = loadHistory().filter((h, i) => !ids.has('h-' + i));
    saveHistoryList(list);
  } else {
    saveAssets(loadAssets().filter(a => !ids.has(a.id)));
  }
  hmState.selected.clear();
  updateHmSelectedCount();
  renderHmBody();
  showStatus('已删除', 'success');
}
function renderHmBody() {
  const body = $('#dynHmBody');
  if (!body) return;
  const list = (hmState.main === 'history' ? loadHistory() : loadAssets())
    .map((item, i) => ({ item, key: item.id || ('h-' + i) }))
    .filter(({ item }) => hmState.type === 'all' || item.type === hmState.type)
    .filter(({ item }) => !hmState.search || (item.prompt || '').toLowerCase().includes(hmState.search))
    .sort((a, b) => (b.item.ts || b.item.addedAt || 0) - (a.item.ts || a.item.addedAt || 0));

  if (!list.length) {
    body.innerHTML = `<div class="dyn-empty">${hmState.search ? '没有匹配的结果' : (hmState.main === 'history' ? '暂无历史记录' : '资产库为空')}</div>`;
    return;
  }
  // 按日期分组
  const groups = {};
  list.forEach(({ item, key }) => {
    const ts = item.ts || item.addedAt || Date.now();
    const d = new Date(ts);
    const day = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    if (!groups[day]) groups[day] = [];
    groups[day].push({ item, key });
  });
  body.innerHTML = Object.entries(groups).map(([day, items]) => `
    <div class="dyn-day">${day}</div>
    <div class="dyn-grid">${items.map(({ item, key }) => renderHmCard(item, key)).join('')}</div>
  `).join('');

  body.querySelectorAll('.dyn-card').forEach(card => {
    const key = card.dataset.key;
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('dyn-star')) return;
      if (hmState.batch || e.target.classList.contains('dyn-check')) {
        if (hmState.selected.has(key)) { hmState.selected.delete(key); card.classList.remove('selected'); }
        else { hmState.selected.add(key); card.classList.add('selected'); }
        updateHmSelectedCount();
        return;
      }
      const srcList = (hmState.main === 'history' ? loadHistory() : loadAssets());
      const i = key.startsWith('h-') ? Number(key.slice(2)) : srcList.findIndex(x => x.id === key);
      const item = srcList[i];
      if (item) loadFromHistory(item);
    });
    const star = card.querySelector('.dyn-star');
    if (star) star.addEventListener('click', (e) => {
      e.stopPropagation();
      const srcList = (hmState.main === 'history' ? loadHistory() : loadAssets());
      const i = key.startsWith('h-') ? Number(key.slice(2)) : srcList.findIndex(x => x.id === key);
      const item = srcList[i];
      if (item) addCurrentToAssets(item, star);
    });
  });
}
function renderHmCard(item, key) {
  const inAssets = isAsseted(item.src);
  let media = '';
  if (item.type === 'image') media = `<img src="${escapeAttr(item.src)}" alt="" />`;
  else if (item.type === 'video') media = `<video src="${escapeAttr(item.src)}" muted></video>`;
  const tl = item.type === 'image' ? '图片' : '视频';
  return `
    <div class="dyn-card" data-key="${escapeAttr(key)}">
      <div class="dyn-check">✓</div>
      ${media}
      <span class="dyn-badge">${tl}</span>
      ${hmState.main === 'history' ? `<button class="dyn-star${inAssets ? ' added' : ''}" title="${inAssets ? '已在资产' : '加入资产'}">${inAssets ? '★' : '+'}</button>` : ''}
    </div>
  `;
}
function loadFromHistory(h) {
  if (state.type !== h.type) switchType(h.type);
  if (h.model) {
    state.model = h.model;
    state.flavor = h.flavor || state.flavor;
    setTimeout(() => {
      $$('.model-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.id === h.model && (el.dataset.flavor || '') === (h.flavor || ''));
      });
    }, 50);
  }
  $('#prompt').value = h.prompt || '';
  autoResize({ target: $('#prompt') });
  if (h.type === 'image') showCanvasResult(`<img src="${escapeAttr(h.src)}" alt="" />`);
  else if (h.type === 'video') showCanvasResult(`<video src="${escapeAttr(h.src)}" controls autoplay loop></video>`);
  if (h.refImages) state.refImages = h.refImages;
  renderAttachments();
  renderParamsPanel();
  closeHistoryModal();
  showStatus('已加载历史', 'success');
}
function addCurrentToAssets(h, btn) {
  if (isAsseted(h.src)) {
    if (btn) { btn.classList.add('added'); btn.textContent = '★'; btn.title = '已在资产中'; }
    showStatus('已在资产中', 'success');
    return;
  }
  addAsset({ type: h.type, src: h.src, prompt: h.prompt });
  if (btn) { btn.classList.add('added'); btn.textContent = '★'; btn.title = '已添加到资产'; }
  renderHmBody();
  showStatus('已添加到资产', 'success');
}
function saveHistoryList(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }

// ============== @ 资产选择器 (JS 动态创建) ==============
let pickerTarget = null;

function onPromptInput(e) {
  const ta = e.target;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const m = before.match(/@([^@\s]*)$/);
  if (m) openAssetPicker(ta, m[1]);
  else closeAssetPicker();
}

// @ 选择器数据源:合并「资产库 + 当前附件」,附件排前面(用户刚上传的优先)
function loadPickerItems() {
  const items = [];
  // 附件(本会话上传的参考图)
  state.refImages.forEach((src, i) => {
    items.push({ id: `attach-${i}`, type: 'image', src, source: 'attach', label: `附件 ${i + 1}` });
  });
  // 资产库
  loadAssets().forEach((a) => {
    items.push({ id: a.id, type: a.type, src: a.src, source: 'asset', label: a.prompt || '' });
  });
  return items;
}

function openAssetPicker(ta, query) {
  if (loadPickerItems().length === 0) { closeAssetPicker(); return; }
  closeAssetPicker();
  ensureModalCss();
  // 动态创建选择器
  const pk = document.createElement('div');
  pk.id = 'dynPicker';
  pk.style.cssText = 'position:fixed;z-index:9995;background:linear-gradient(160deg,rgba(30,36,66,.95),rgba(20,24,48,.9));border:1px solid rgba(140,150,220,.22);border-radius:12px;box-shadow:0 16px 48px rgba(4,4,20,.55);width:340px;max-height:260px;overflow:hidden;display:flex;flex-direction:column';
  const head = document.createElement('div');
  head.style.cssText = 'padding:8px 12px;font-size:11px;color:#7c87ad;border-bottom:1px solid rgba(140,150,220,.14)';
  head.textContent = '选择资产 · ↑↓ 选择 · Enter 确认 · Esc 取消';
  const grid = document.createElement('div');
  grid.id = 'dynPickerGrid';
  grid.style.cssText = 'overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px';
  pk.appendChild(head);
  pk.appendChild(grid);
  document.body.appendChild(pk);
  pk.dataset.selectedIndex = '0';

  const rect = ta.getBoundingClientRect();
  pk.style.left = Math.min(rect.left, window.innerWidth - 360) + 'px';
  pk.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

  const render = () => {
    const list = loadPickerItems();
    if (!list.length) { closeAssetPicker(); return; }
    grid.innerHTML = list.map((a, i) => {
      let media = '';
      if (a.type === 'image') media = `<img src="${escapeAttr(a.src)}" style="width:100%;height:100%;object-fit:cover" />`;
      else if (a.type === 'video') media = `<video src="${escapeAttr(a.src)}" muted style="width:100%;height:100%;object-fit:cover"></video>`;
      else media = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#fff3e0,#ffe0b2)">🎵</div>`;
      const tag = a.source === 'attach'
        ? `<span style="position:absolute;top:2px;left:2px;font-size:9px;background:rgba(91,61,255,.85);color:#fff;border-radius:4px;padding:0 4px">📎</span>`
        : `<span style="position:absolute;bottom:2px;right:4px;font-size:9px;color:#999">#${escapeHtml(a.id.slice(-4))}</span>`;
      return `<div class="dyn-pick-item${i === 0 ? ' selected' : ''}" data-idx="${i}" style="aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;position:relative;border:2px solid transparent;background:rgba(24,28,52,.8)">${media}${tag}</div>`;
    }).join('');
    grid.querySelectorAll('.dyn-pick-item').forEach(el => {
      el.addEventListener('click', () => selectPickerItem(Number(el.dataset.idx)));
      el.addEventListener('mouseenter', () => {
        grid.querySelectorAll('.dyn-pick-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        pk.dataset.selectedIndex = String(el.dataset.idx);
      });
    });
  };
  // 选中态样式(注入一次)
  const st = document.createElement('style');
  st.textContent = '.dyn-pick-item.selected{border-color:#8a5cf5;box-shadow:0 0 0 2px rgba(138,92,245,.3)}';
  document.head.appendChild(st);
  pk._render = render;
  render();

  // direct 模式(@ 按钮点击): atPos = 光标当前位置;否则为 @ 前的位置
  const atPos = query === null
    ? (ta.selectionStart || ta.value.length)
    : (ta.selectionStart - (query ? query.length : 0) - 1);
  pickerTarget = { textarea: ta, atPos };
}

function closeAssetPicker() {
  const pk = document.getElementById('dynPicker');
  if (pk) pk.remove();
  pickerTarget = null;
}
function movePickerSelection(delta) {
  const list = loadPickerItems();
  if (!list.length) return;
  const pk = document.getElementById('dynPicker');
  if (!pk) return;
  let idx = Number(pk.dataset.selectedIndex || 0);
  idx = (idx + delta + list.length) % list.length;
  pk.dataset.selectedIndex = String(idx);
  const grid = document.getElementById('dynPickerGrid');
  if (!grid) return;
  grid.querySelectorAll('.dyn-pick-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
    if (i === idx) el.scrollIntoView({ block: 'nearest' });
  });
}
function selectPickerItem(idx) {
  const list = loadPickerItems();
  const a = list[idx];
  if (!a || !pickerTarget) return;
  const ta = pickerTarget.textarea;
  // 附件:已在 state.refImages,提到第一位作为主参考,不插入占位符
  if (a.source === 'attach') {
    state.refImages = [a.src, ...state.refImages.filter(u => u !== a.src)].slice(0, 3);
    renderAttachments();
    closeAssetPicker();
    ta.focus();
    showStatus('已选择附件作为参考图', 'ok');
    return;
  }
  // 资产:插入占位符,提交时由 resolveAssetRefs 解析为参考图 URL
  const before = ta.value.slice(0, pickerTarget.atPos);
  const after = ta.value.slice(ta.selectionStart);
  const insertText = `{{asset:${a.id}}}`;
  ta.value = before + insertText + after;
  const newPos = before.length + insertText.length;
  ta.setSelectionRange(newPos, newPos);
  ta.focus();
  closeAssetPicker();
  autoResize({ target: ta });
}

document.addEventListener('keydown', (e) => {
  const pk = document.getElementById('dynPicker');
  if (!pk) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); movePickerSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePickerSelection(-1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    selectPickerItem(Number(pk.dataset.selectedIndex || 0));
  } else if (e.key === 'Escape') {
    closeAssetPicker();
  }
});

function resolveAssetRefs(prompt) {
  const re = /\{\{asset:([^}]+)\}\}/g;
  const assetIds = [];
  let m;
  while ((m = re.exec(prompt)) !== null) assetIds.push(m[1]);
  const cleanPrompt = prompt.replace(re, '').replace(/\s+/g, ' ').trim();
  if (assetIds.length) {
    const assets = loadAssets();
    const urls = assetIds.map(id => {
      const a = assets.find(x => x.id === id);
      return a ? a.src : null;
    }).filter(Boolean);
    if (urls.length) {
      state.refImages = [...urls, ...state.refImages.filter(u => !urls.includes(u))].slice(0, 3);
    }
  }
  return cleanPrompt;
}

// ============== API 设置弹窗 (JS 动态创建) ==============
function openApiModal() {
  ensureModalCss();
  const old = document.getElementById('dynOverlay');
  if (old) old.remove();
  const s = loadApiSettings();

  const overlay = document.createElement('div');
  overlay.id = 'dynOverlay';
  overlay.innerHTML = `
    <div style="background:linear-gradient(160deg,rgba(30,36,66,.92),rgba(20,24,48,.86));border:1px solid rgba(140,150,220,.2);border-radius:16px;box-shadow:0 24px 70px rgba(4,4,20,.6);width:440px;max-width:92vw;overflow:hidden;animation:dynUp .18s">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(140,150,220,.14)">
        <h3 style="margin:0;font-size:16px;color:#eef2ff">⚙️ API 设置</h3>
        <button class="dyn-close" id="dynApiClose">✕</button>
      </div>
      <div style="padding:20px">
        <label style="display:block;font-size:13px;font-weight:600;color:#a5b0d6;margin:12px 0 6px">API Key</label>
        <div style="display:flex;align-items:center;background:rgba(16,20,40,.6);border:1px solid rgba(140,150,220,.2);border-radius:8px;overflow:hidden">
          <input id="dynApiKey" type="password" style="flex:1;border:none;outline:none;background:transparent;padding:10px 12px;font-size:14px;font-family:monospace;color:#eef2ff" placeholder="sk-..." autocomplete="off" />
          <button id="dynApiToggle" style="background:transparent;border:none;padding:0 12px;font-size:16px;cursor:pointer;color:#a5b0d6">👁</button>
        </div>
        <p style="font-size:12px;color:#7c87ad;margin:6px 0 0">填写你自己的 API Key,留空则使用服务器 .env 中的配置</p>
        <label style="display:block;font-size:13px;font-weight:600;color:#a5b0d6;margin:12px 0 6px">Base URL</label>
        <input id="dynApiBase" type="text" style="width:100%;box-sizing:border-box;background:rgba(16,20,40,.6);border:1px solid rgba(140,150,220,.2);border-radius:8px;padding:10px 12px;font-size:14px;outline:none;color:#eef2ff" placeholder="https://ai.comfly.org" />
        <p style="font-size:12px;color:#7c87ad;margin:6px 0 0">接口根地址,默认 https://ai.comfly.org</p>
        <label style="display:block;font-size:13px;font-weight:600;color:#a5b0d6;margin:12px 0 6px">RunningHub Key</label>
        <div style="display:flex;align-items:center;background:rgba(16,20,40,.6);border:1px solid rgba(140,150,220,.2);border-radius:8px;overflow:hidden">
          <input id="dynRhKey" type="password" style="flex:1;border:none;outline:none;background:transparent;padding:10px 12px;font-size:14px;font-family:monospace;color:#eef2ff" placeholder="RunningHub 32位 API Key" autocomplete="off" />
          <button id="dynRhToggle" style="background:transparent;border:none;padding:0 12px;font-size:16px;cursor:pointer;color:#a5b0d6">👁</button>
        </div>
        <p style="font-size:12px;color:#7c87ad;margin:6px 0 0">RunningHub 工作流专用 Key(32位),与上面的 comfly Key 独立</p>
        <div style="display:flex;gap:10px;margin-top:22px">
          <button id="dynApiSave" style="flex:1;background:linear-gradient(135deg,#8a5cf5,#4cc9f0);color:#fff;border:none;padding:10px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(138,92,245,.35)">保存</button>
          <button id="dynApiClear" style="background:rgba(30,36,66,.6);border:1px solid rgba(140,150,220,.2);color:#a5b0d6;padding:10px 18px;border-radius:8px;font-size:14px;cursor:pointer">清除</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeApiModal(); });

  $('#dynApiKey').value = s.apiKey || '';
  $('#dynApiBase').value = s.baseUrl || '';
  $('#dynRhKey').value = s.rhKey || '';
  $('#dynApiClose').addEventListener('click', closeApiModal);
  $('#dynApiToggle').addEventListener('click', () => {
    const inp = $('#dynApiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#dynApiToggle').textContent = inp.type === 'password' ? '👁' : '🙈';
  });
  $('#dynRhToggle').addEventListener('click', () => {
    const inp = $('#dynRhKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#dynRhToggle').textContent = inp.type === 'password' ? '👁' : '🙈';
  });
  $('#dynApiSave').addEventListener('click', saveApiSettingsFromForm);
  $('#dynApiClear').addEventListener('click', clearApiSettings);
  // Esc 关闭
  const onEsc = (e) => {
    if (e.key === 'Escape') { closeApiModal(); document.removeEventListener('keydown', onEsc); }
  };
  document.addEventListener('keydown', onEsc);
}
function closeApiModal() {
  const o = document.getElementById('dynOverlay');
  if (o) o.remove();
}
function saveApiSettingsFromForm() {
  const apiKey = ($('#dynApiKey').value || '').trim();
  const baseUrl = ($('#dynApiBase').value || '').trim();
  const rhKey = ($('#dynRhKey').value || '').trim();
  saveApiSettings({ apiKey, baseUrl, rhKey });
  showStatus(apiKey || rhKey ? 'API 设置已保存' : '已清除,使用服务器默认配置', 'success');
  closeApiModal();
}
function clearApiSettings() {
  localStorage.removeItem(API_SETTINGS_KEY);
  showStatus('已清除 API 配置,使用服务器 .env 默认', 'success');
  closeApiModal();
}

// ============== 登录 / 注册 / 账户 / 积分 ==============

// 统一的遮罩 + 弹窗容器（动态创建，风格与历史弹窗一致）
function dynShell(html) {
  const overlay = document.createElement('div');
  overlay.id = 'dynOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,20,0.72);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'width:420px;max-width:92vw;max-height:86vh;overflow-y:auto;border-radius:18px;background:linear-gradient(165deg,rgba(32,38,70,0.96),rgba(22,26,52,0.94));border:1px solid rgba(140,150,220,0.22);box-shadow:0 20px 60px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06);color:#eef2ff;padding:26px 28px;position:relative;';
  box.innerHTML = html;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  return { overlay, box };
}

// 打开登录/注册弹窗: mode = 'login' | 'register'
function openAuthModal(mode) {
  closeApiModal();
  const isLogin = mode === 'login';
  const { overlay, box } = dynShell(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
      <h2 style="margin:0;font-size:20px;background:linear-gradient(90deg,#a78bfa,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent;">${isLogin ? '登录' : '注册'}</h2>
      <button id="authClose" style="background:rgba(255,255,255,0.08);border:1px solid rgba(140,150,220,0.25);color:#c9d2f0;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;">✕</button>
    </div>
    <div id="authErr" style="display:none;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;padding:9px 12px;border-radius:9px;font-size:13px;margin-bottom:12px;"></div>

    <label style="font-size:13px;color:#a5b0d6;display:block;margin:10px 0 5px;">用户名</label>
    <input id="authUser" placeholder="3-20 位字母数字" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,150,220,0.25);background:rgba(12,16,30,0.6);color:#eef2ff;font-size:14px;outline:none;"/>

    ${isLogin ? '' : `
    <label style="font-size:13px;color:#a5b0d6;display:block;margin:10px 0 5px;">邮箱</label>
    <input id="authEmail" type="email" placeholder="you@example.com" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,150,220,0.25);background:rgba(12,16,30,0.6);color:#eef2ff;font-size:14px;outline:none;"/>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <input id="authCode" placeholder="邮箱验证码" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,150,220,0.25);background:rgba(12,16,30,0.6);color:#eef2ff;font-size:14px;outline:none;"/>
      <button id="authSendCode" style="white-space:nowrap;padding:0 14px;border-radius:10px;border:1px solid rgba(140,150,220,0.3);background:rgba(124,92,245,0.2);color:#c4b5fd;cursor:pointer;font-size:13px;">获取验证码</button>
    </div>
    <label style="font-size:13px;color:#a5b0d6;display:block;margin:10px 0 5px;">邀请码（选填）</label>
    <input id="authInvite" placeholder="有邀请码可填写" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,150,220,0.25);background:rgba(12,16,30,0.6);color:#eef2ff;font-size:14px;outline:none;"/>
    `}

    <label style="font-size:13px;color:#a5b0d6;display:block;margin:10px 0 5px;">密码</label>
    <input id="authPass" type="password" placeholder="至少 6 位" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,150,220,0.25);background:rgba(12,16,30,0.6);color:#eef2ff;font-size:14px;outline:none;"/>

    <button id="authSubmit" style="width:100%;margin-top:18px;padding:11px 0;border:none;border-radius:12px;background:linear-gradient(90deg,#8b5cf6,#22d3ee);color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(139,92,246,0.35);">${isLogin ? '登 录' : '注 册'}</button>
    <div style="text-align:center;margin-top:12px;font-size:13px;color:#8b93b8;">
      ${isLogin ? '还没有账号？<a id="authSwitch" style="color:#a78bfa;cursor:pointer;">去注册</a>' : '已有账号？<a id="authSwitch" style="color:#a78bfa;cursor:pointer;">去登录</a>'}
    </div>
  `);
  $('#authClose').addEventListener('click', () => overlay.remove());
  const sw = $('#authSwitch');
  if (sw) sw.addEventListener('click', () => { overlay.remove(); openAuthModal(isLogin ? 'register' : 'login'); });

  // 发送验证码
  const sendBtn = $('#authSendCode');
  if (sendBtn) sendBtn.addEventListener('click', async () => {
    const email = ($('#authEmail').value || '').trim();
    if (!email) { showAuthErr('请先填写邮箱'); return; }
    sendBtn.disabled = true; sendBtn.textContent = '发送中...';
    try {
      const r = await fetch('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const d = await r.json();
      if (d.ok) { showAuthErr('验证码已发送到邮箱', 'ok'); let n = 60; const t = setInterval(() => { n--; sendBtn.textContent = n + 's'; if (n <= 0) { clearInterval(t); sendBtn.disabled = false; sendBtn.textContent = '获取验证码'; } }, 1000); }
      else { showAuthErr(d.error || '发送失败'); sendBtn.disabled = false; sendBtn.textContent = '获取验证码'; }
    } catch (e) { showAuthErr(e.message); sendBtn.disabled = false; sendBtn.textContent = '获取验证码'; }
  });

  // 提交
  $('#authSubmit').addEventListener('click', async () => {
    const username = ($('#authUser').value || '').trim();
    const password = $('#authPass').value || '';
    const email = ($('#authEmail') ? ($('#authEmail').value || '').trim() : '');
    const code = ($('#authCode') ? ($('#authCode').value || '').trim() : '');
    const inviteCode = ($('#authInvite') ? ($('#authInvite').value || '').trim() : '');
    if (!username || !password) { showAuthErr('用户名和密码不能为空'); return; }
    if (!isLogin && (!email || !code)) { showAuthErr('请填写邮箱和验证码'); return; }
    const btn = $('#authSubmit'); btn.disabled = true; btn.textContent = '提交中...';
    try {
      const body = isLogin ? { username, password } : { username, password, email, code, inviteCode, nickname: username };
      const r = await fetch(isLogin ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.ok) {
        saveAuth(d.token, d.user);
        applyUserToUI(d.user, d.bonusCoins || 0);
        showStatus(d.bonusCoins ? `登录成功,每日奖励 +${d.bonusCoins} 金币` : (isLogin ? '登录成功' : '注册成功,欢迎!'), 'success');
        overlay.remove();
      } else { showAuthErr(d.error || '操作失败'); btn.disabled = false; btn.textContent = isLogin ? '登 录' : '注 册'; }
    } catch (e) { showAuthErr(e.message); btn.disabled = false; btn.textContent = isLogin ? '登 录' : '注 册'; }
  });

  function showAuthErr(msg, type) {
    const el = $('#authErr');
    el.style.display = 'block';
    el.textContent = msg;
    el.style.color = type === 'ok' ? '#86efac' : '#fca5a5';
    el.style.background = type === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.15)';
    el.style.borderColor = type === 'ok' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
  }
}

// 账户弹窗（已登录）：余额 / 充值卡密 / 流水 / 退出
async function openUserModal() {
  closeApiModal();
  const { overlay, box } = dynShell(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h2 style="margin:0;font-size:20px;background:linear-gradient(90deg,#a78bfa,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent;">我的账户</h2>
      <button id="userClose" style="background:rgba(255,255,255,0.08);border:1px solid rgba(140,150,220,0.25);color:#c9d2f0;width:30px;height:30px;border-radius:50%;cursor:pointer;">✕</button>
    </div>
    <div style="background:rgba(124,92,245,0.12);border:1px solid rgba(139,92,246,0.3);border-radius:14px;padding:16px;margin-bottom:14px;text-align:center;">
      <div style="font-size:13px;color:#a5b0d6;">当前余额</div>
      <div style="font-size:34px;font-weight:700;color:#fbbf24;margin:4px 0;"><span id="userCoins">0</span> <span style="font-size:16px;">金币</span></div>
      <div id="userName" style="font-size:13px;color:#8b93b8;"></div>
    </div>
    <div style="font-size:14px;color:#eef2ff;margin:14px 0 6px;">充值卡密</div>
    <div style="display:flex;gap:8px;">
      <input id="redeemKey" placeholder="输入卡密兑换金币" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid rgba(140,150,220,0.25);background:rgba(12,16,30,0.6);color:#eef2ff;font-size:14px;outline:none;"/>
      <button id="redeemBtn" style="padding:0 16px;border-radius:10px;border:none;background:linear-gradient(90deg,#8b5cf6,#22d3ee);color:#fff;cursor:pointer;font-weight:600;">兑换</button>
    </div>
    <div style="font-size:14px;color:#eef2ff;margin:16px 0 6px;">金币流水</div>
    <div id="coinLogs" style="max-height:180px;overflow-y:auto;border:1px solid rgba(140,150,220,0.18);border-radius:10px;padding:8px;background:rgba(12,16,30,0.4);font-size:12.5px;"></div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button id="refreshCoins" style="flex:1;padding:9px 0;border-radius:10px;border:1px solid rgba(140,150,220,0.3);background:rgba(255,255,255,0.06);color:#c9d2f0;cursor:pointer;">刷新</button>
      <button id="logoutBtn" style="flex:1;padding:9px 0;border-radius:10px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#fca5a5;cursor:pointer;">退出登录</button>
    </div>
  `);
  $('#userClose').addEventListener('click', () => overlay.remove());
  $('#logoutBtn').addEventListener('click', () => { clearAuth(); applyUserToUI(null); showStatus('已退出登录', 'success'); overlay.remove(); });

  // 填充真实余额（先本地缓存值,再拉最新）
  const setCoinsUI = (coins) => {
    const el = $('#userCoins');
    if (el && coins != null) el.textContent = coins;
    const nm = $('#userName');
    if (nm && currentUser) nm.textContent = (currentUser.nickname || currentUser.username) + (currentUser.role === 'admin' ? '（管理员）' : '');
  };
  if (currentUser) { setCoinsUI(currentUser.coins); }

  $('#redeemBtn').addEventListener('click', async () => {
    const key = ($('#redeemKey').value || '').trim();
    if (!key) { showStatus('请输入卡密', 'error'); return; }
    const r = await fetch('/api/coins/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() }, body: JSON.stringify({ key }) });
    const d = await r.json();
    if (d.ok) { showStatus(`兑换成功 +${d.added} 金币`, 'success'); if (currentUser) currentUser.coins = d.coins; setCoinsUI(d.coins); updateCoinBadge(); loadCoinLogs(); }
    else showStatus(d.error || '兑换失败', 'error');
  });
  $('#refreshCoins').addEventListener('click', async () => {
    const r = await fetch('/api/auth/me', { headers: { ...apiAuthHeaders() } });
    const d = await r.json();
    if (d.ok && d.user) { applyUserToUI(d.user); setCoinsUI(d.user.coins); showStatus('余额已刷新', 'success'); }
  });

  async function loadCoinLogs() {
    const box2 = $('#coinLogs');
    try {
      const r = await fetch('/api/coins/logs', { headers: { ...apiAuthHeaders() } });
      const d = await r.json();
      if (d.ok && d.logs && d.logs.length) {
        box2.innerHTML = d.logs.slice(0, 30).map((l) => {
          const ts = new Date(l.timestamp).toLocaleString('zh-CN');
          const sign = (l.amount > 0 ? '+' : '') + l.amount;
          const color = l.amount >= 0 ? '#86efac' : '#fca5a5';
          return `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 4px;border-bottom:1px solid rgba(140,150,220,0.1);"><span style="color:#a5b0d6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(l.description || l.type)}</span><span style="color:${color};font-weight:600;">${sign}</span><span style="color:#6b7299;font-size:11px;">${ts}</span></div>`;
        }).join('');
      } else {
        box2.innerHTML = '<div style="color:#6b7299;padding:8px;text-align:center;">暂无流水</div>';
      }
    } catch (e) {
      box2.innerHTML = '<div style="color:#fca5a5;padding:8px;">加载失败</div>';
    }
  }
  loadCoinLogs();
  // 打开时自动刷新一次真实余额（保证显示最新, 不依赖缓存）
  (async () => {
    try {
      const r = await fetch('/api/auth/me', { headers: { ...apiAuthHeaders() } });
      const d = await r.json();
      if (d.ok && d.user) { currentUser = d.user; setCoinsUI(d.user.coins); updateCoinBadge(); }
    } catch { /* 忽略, 用缓存值 */ }
  })();
}

// 恢复登录态（页面加载时）
async function restoreSession() {
  if (!currentToken) { applyUserToUI(null); return; }
  try {
    const r = await fetch('/api/auth/me', { headers: { ...apiAuthHeaders() } });
    const d = await r.json();
    if (d.ok && d.user) { currentUser = d.user; applyUserToUI(d.user); }
    else { clearAuth(); applyUserToUI(null); }
  } catch { /* 网络失败保留本地缓存 */ applyUserToUI(currentUser); }
}

// 把用户信息渲染到顶栏
function applyUserToUI(user, bonus = 0) {
  currentUser = user || null;
  const nameEl = $('#userNameText');
  const badge = $('#coinBadge');
  const coinEl = $('#coinText');
  const apiBtn = $('#openApiBtn');
  // API 设置按钮: 仅管理员可见（暂不对外开放）
  if (apiBtn) apiBtn.style.display = (user && user.role === 'admin') ? 'inline-block' : 'none';
  if (!user) {
    if (nameEl) nameEl.textContent = '登录';
    if (badge) badge.style.display = 'none';
    return;
  }
  if (nameEl) nameEl.textContent = user.nickname || user.username;
  if (badge) badge.style.display = 'inline-flex';
  if (coinEl) coinEl.textContent = user.coins != null ? user.coins : (bonus > 0 ? bonus : 0);
}

function updateCoinBadge() {
  const coinEl = $('#coinText');
  if (coinEl && currentUser) coinEl.textContent = currentUser.coins != null ? currentUser.coins : coinEl.textContent;
}