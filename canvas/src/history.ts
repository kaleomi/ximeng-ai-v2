import type { NodeData } from './workflow';
export const HISTORY_KEY = 'ai_media_history';
export interface HistoryEntry { type: string; src: string; images?: string[]; model?: string; prompt?: string; ts?: number; }
export function safeHistoryUrl(value: unknown): value is string { return typeof value === 'string' && /^(https?:\/\/|data:(image\/(png|jpeg|webp|gif|bmp)|video\/mp4|audio\/[a-z0-9.+-]+);base64,)/i.test(value); }
export function readHistory(): HistoryEntry[] {
  const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (!Array.isArray(raw)) throw new Error('历史记录格式无效');
  return raw.filter(e => e && typeof e.src === 'string' && ['image', 'video', 'audio', 'text'].includes(e.type)).map(e => ({
    type: e.type, src: e.src, images: Array.isArray(e.images) ? e.images.filter(safeHistoryUrl) : undefined,
    model: typeof e.model === 'string' ? e.model : '', prompt: typeof e.prompt === 'string' ? e.prompt : '', ts: typeof e.ts === 'number' ? e.ts : undefined,
  }));
}
export function saveToMainHistory(entry: Record<string, unknown>) {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(raw)) throw new Error('历史记录格式无效');
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ ...entry, ts: Date.now() }, ...raw].slice(0, 50)));
    window.dispatchEvent(new Event('canvas-history-change'));
  } catch {
    window.dispatchEvent(new CustomEvent('canvas-notice', { detail: '生成已完成，但历史记录保存失败，请先导出工作流保留结果' }));
  }
}
export function historyNodeData(entry: HistoryEntry, selected?: string): NodeData {
  const src = selected || entry.src;
  if (entry.type !== 'text' && !safeHistoryUrl(src)) throw new Error('这条记录的文件链接无效');
  return { title: '历史结果 · ' + (entry.model || entry.type), status: 'completed', prompt: entry.prompt || '',
    ...(entry.type === 'image' ? { imageUrl: src, images: entry.images?.length ? entry.images.filter(safeHistoryUrl) : [src] }
      : entry.type === 'video' ? { videoUrl: src } : entry.type === 'audio' ? { audioUrl: src } : { text: src }), output: src };
}
