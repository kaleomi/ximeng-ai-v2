// Supabase REST 封装 — Cloudflare Workers 版
// 环境变量通过 setEnv(env) 注入（由 worker/index.js 调用）
// ⚠️ key 只从环境变量读取（已在 Cloudflare 配置 VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY）
let ENV = {};
export function setEnv(env) { ENV = env || {}; }

const DEFAULT_SUPABASE_URL = 'https://bdzaifcqzsymfypzxisn.supabase.co';

export function supabaseConfig() {
  return {
    url: ENV.VITE_SUPABASE_URL || ENV.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    key: ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.VITE_SUPABASE_ANON_KEY || ENV.SUPABASE_ANON_KEY || '',
  };
}

function headers(extra = {}) {
  const { key } = supabaseConfig();
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

// 通用查询（与 server/supabase.js 相同的链式 API）
export function supabaseFrom(table) {
  const { url } = supabaseConfig();
  let filterStr = '';
  let cols = '*';

  const q = {
    eq(k, v) { filterStr += `&${k}=eq.${encodeURIComponent(v)}`; return q; },
    neq(k, v) { filterStr += `&${k}=neq.${encodeURIComponent(v)}`; return q; },
    ilike(k, v) { filterStr += `&${k}=ilike.${encodeURIComponent(v)}`; return q; },
    in(k, arr) { filterStr += `&${k}=in.(${arr.map(encodeURIComponent).join(',')})`; return q; },
    gt(k, v) { filterStr += `&${k}=gt.${encodeURIComponent(v)}`; return q; },
    gte(k, v) { filterStr += `&${k}=gte.${encodeURIComponent(v)}`; return q; },
    lt(k, v) { filterStr += `&${k}=lt.${encodeURIComponent(v)}`; return q; },
    lte(k, v) { filterStr += `&${k}=lte.${encodeURIComponent(v)}`; return q; },
    order(k, opts = {}) { if (filterStr || cols) filterStr += `&order=${encodeURIComponent(k)}${opts.ascending === false ? '.desc' : ''}`; return q; },
    limit(n) { filterStr += `&limit=${n}`; return q; },
    range(from, to) { filterStr += `&offset=${from}&limit=${to - from + 1}`; return q; },
    select(c = '*') { cols = c; filterStr = ''; return q; },

    url() {
      return `${url}/rest/v1/${table}?select=${encodeURIComponent(cols)}${filterStr}`;
    },
    async execute() {
      const res = await fetch(q.url(), { headers: headers() });
      if (!res.ok) { const t = await res.text(); return { data: null, error: { code: String(res.status), message: t } }; }
      return { data: await res.json(), error: null };
    },
    async single() {
      const res = await fetch(q.url() + '&limit=1', { headers: headers() });
      if (!res.ok) { const t = await res.text(); return { data: null, error: { code: String(res.status), message: t } }; }
      const arr = await res.json();
      return { data: arr[0] || null, error: null };
    },
    async maybeSingle() {
      const res = await fetch(q.url() + '&limit=1', { headers: headers() });
      if (!res.ok) { const t = await res.text(); return { data: null, error: { code: String(res.status), message: t } }; }
      const arr = await res.json();
      return { data: arr[0] || null, error: null };
    },
    async insert(row) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row),
      });
      if (!res.ok) { const t = await res.text(); return { data: null, error: { code: String(res.status), message: t } }; }
      return { data: await res.json(), error: null };
    },
    async update(row) {
      const res = await fetch(`${url}/rest/v1/${table}?${filterStr.replace(/^&/, '')}`, {
        method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row),
      });
      if (!res.ok) { const t = await res.text(); return { data: null, error: { code: String(res.status), message: t } }; }
      return { data: await res.json(), error: null };
    },
    async delete() {
      const res = await fetch(`${url}/rest/v1/${table}?${filterStr.replace(/^&/, '')}`, { method: 'DELETE', headers: headers() });
      if (!res.ok) { const t = await res.text(); return { data: null, error: { code: String(res.status), message: t } }; }
      const t = await res.text();
      let data = null;
      try { data = t ? JSON.parse(t) : null; } catch { data = null; }
      return { data, error: null };
    },
  };
  return q;
}

export async function supabaseHealth() {
  try {
    const { data, error } = await supabaseFrom('users').select('id').limit(1).execute();
    return { ok: !error, error: error ? error.message : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
