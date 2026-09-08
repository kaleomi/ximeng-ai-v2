// 零依赖 JWT (HS256) — Cloudflare Workers 版
// 用 Web Crypto API 实现，与 jsonwebtoken 签发的 token 完全兼容
// （HS256 算法，JWT_SECRET 与夏洛熙一致，登录态互通）

function getSecret(secret) {
  return new TextEncoder().encode(secret);
}

function base64UrlEncode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return new TextDecoder().decode(Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0)));
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', getSecret(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signToken(payload, secret, expiresInSec = 7 * 24 * 3600) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }));
  const sig = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

export async function verifyToken(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = await hmacSign(`${header}.${body}`, secret);
    // 常量时间比较
    const a = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')));
    const b = Uint8Array.from(atob(expected.replace(/-/g, '+').replace(/_/g, '/')));
    if (a.length !== b.length) return null;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return null;

    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
