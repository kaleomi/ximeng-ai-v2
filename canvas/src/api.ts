export function apiAuthHeaders(): Record<string, string> {
  let settings: { apiKey?: string; baseUrl?: string; rhKey?: string } = {};
  try { settings = JSON.parse(localStorage.getItem('ai_media_api_settings') || '{}'); } catch { /* server defaults */ }
  const headers: Record<string, string> = {};
  if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
  if (settings.baseUrl) headers['x-base-url'] = settings.baseUrl;
  if (settings.rhKey) headers['x-rh-key'] = settings.rhKey;
  const token = localStorage.getItem('ai_media_auth');
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}
export async function apiRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { ...apiAuthHeaders(), ...init.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error('服务暂不可用（' + response.status + '）'); }
  if (!response.ok || !data.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || '请求失败（' + response.status + '）');
  return data;
}
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
export function validateImage(file: File) {
  if (!IMAGE_ACCEPT.split(',').includes(file.type)) throw new Error('支持 PNG、JPG、WebP、GIF、BMP 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
}
export async function uploadImage(file: File, signal?: AbortSignal): Promise<string> {
  validateImage(file);
  const body = new FormData(); body.append('file', file);
  const data = await apiRequest('/api/upload', { method: 'POST', body, signal });
  if (typeof data.url !== 'string' || !/^https?:\/\//i.test(data.url)) throw new Error('上传服务没有返回有效的图片地址');
  return data.url;
}
export function notify(message: string) { window.dispatchEvent(new CustomEvent('canvas-notice', { detail: message })); }
const pendingImages = new Map<string, File>();
export function queueImage(id: string, file: File) { pendingImages.set(id, file); }
export function takeImage(id: string) { const file = pendingImages.get(id); pendingImages.delete(id); return file; }
