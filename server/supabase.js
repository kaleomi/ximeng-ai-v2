// Supabase REST 封装 —— 零依赖，直接 fetch 调用，Node 与 Worker 通用
// 认证：优先 Service Role Key（完整权限），缺省用 Anon Key（本项目 RLS 开放读写）

function getEnv(name, fallback = '') {
  return (typeof process !== 'undefined' && process.env && process.env[name]) || fallback;
}

export function supabaseConfig() {
  return {
    url: getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL') || 'https://bdzaifcqzsymfypzxisn.supabase.co',
    key: getEnv('SUPABASE_SERVICE_ROLE_KEY') || getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY') || '',
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

function qs(filters = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

// 通用查询: supabaseFrom('users').select('*').eq('username','x').single()
export function supabaseFrom(table) {
  const { url } = supabaseConfig();
  let filterStr = '';
  let cols = '*';
  let hasQuery = false;

  const q = {
    // 过滤条件：无条件累积（select 会重置）；update/delete 直接用累积的条件
    eq(k, v) { filterStr += `&${k}=eq.${encodeURIComponent(v)}`; return q; },
    neq(k, v) { filterStr += `&${k}=neq.${encodeURIComponent(v)}`; return q; },
    ilike(k, v) { filterStr += `&${k}=ilike.${encodeURIComponent(v)}`; return q; },
    in(k, arr) { if (hasQuery) filterStr += `&${k}=in.(${arr.map(encodeURIComponent).join(',')})`; return q; },
    gt(k, v) { if (hasQuery) filterStr += `&${k}=gt.${encodeURIComponent(v)}`; return q; },
    gte(k, v) { if (hasQuery) filterStr += `&${k}=gte.${encodeURIComponent(v)}`; return q; },
    lt(k, v) { if (hasQuery) filterStr += `&${k}=lt.${encodeURIComponent(v)}`; return q; },
    lte(k, v) { if (hasQuery) filterStr += `&${k}=lte.${encodeURIComponent(v)}`; return q; },
    order(k, opts = {}) { if (hasQuery) filterStr += `&order=${encodeURIComponent(k)}${opts.ascending === false ? '.desc' : ''}`; return q; },
    limit(n) { if (hasQuery) filterStr += `&limit=${n}`; return q; },
    range(from, to) { if (hasQuery) filterStr += `&offset=${from}&limit=${to - from + 1}`; return q; },

    select(colsArg = '*') {
      cols = colsArg;
      hasQuery = true;
      filterStr = '';
      return q;
    },

    url() {
      return `${url}/rest/v1/${table}?select=${encodeURIComponent(cols)}${filterStr}`;
    },

    async execute() {
      const res = await fetch(q.url(), { headers: headers() });
      if (!res.ok) {
        const t = await res.text();
        return { data: null, error: { code: String(res.status), message: t } };
      }
      return { data: await res.json(), error: null };
    },

    async single() {
      const res = await fetch(q.url() + '&limit=1', { headers: headers() });
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 406) return { data: null, error: { code: 'PGRST116', message: 'No rows' } };
        return { data: null, error: { code: String(res.status), message: t } };
      }
      const arr = await res.json();
      return { data: arr[0] || null, error: null };
    },

    async maybeSingle() {
      const res = await fetch(q.url() + '&limit=1', { headers: headers() });
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 406) return { data: null, error: null };
        return { data: null, error: { code: String(res.status), message: t } };
      }
      const arr = await res.json();
      return { data: arr[0] || null, error: null };
    },

    async insert(row) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const t = await res.text();
        return { data: null, error: { code: String(res.status), message: t } };
      }
      return { data: await res.json(), error: null };
    },

    async update(row) {
      const res = await fetch(`${url}/rest/v1/${table}?${filterStr.replace(/^&/, '')}`, {
        method: 'PATCH',
        headers: headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const t = await res.text();
        return { data: null, error: { code: String(res.status), message: t } };
      }
      return { data: await res.json(), error: null };
    },

    async delete() {
      const res = await fetch(`${url}/rest/v1/${table}?${filterStr.replace(/^&/, '')}`, {
        method: 'DELETE',
        headers: headers(),
      });
      if (!res.ok) {
        const t = await res.text();
        return { data: null, error: { code: String(res.status), message: t } };
      }
      const t = await res.text();
      let data = null;
      try { data = t ? JSON.parse(t) : null; } catch { data = null; }
      return { data, error: null };
    },
  };
  return q;
}

// RPC 调用 (Postgres 函数)
export async function supabaseRpc(fn, args = {}) {
  const { url } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const t = await res.text();
    return { data: null, error: { code: String(res.status), message: t } };
  }
  return { data: await res.json(), error: null };
}

// 简单健康检查
export async function supabaseHealth() {
  try {
    const { data, error } = await supabaseFrom('users').select('id').limit(1).execute();
    return { ok: !error, error: error ? error.message : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const getSupabase = () => supabaseFrom;
export const supabase = supabaseFrom;
