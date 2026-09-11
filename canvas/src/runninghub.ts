import type { NodeData, PortType } from './workflow';
export interface RHField { nodeId: string; fieldName: string; fieldType: string; fieldValue: string; fieldData: string; label: string; }
export interface RHSchema { appId: string; title: string; fields: RHField[]; }
export const rhPort = (f: RHField) => 'rh:' + f.nodeId + ':' + f.fieldName;
export const rhType = (f: RHField): PortType | undefined => ({ IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', STRING: 'text' } as Record<string, PortType>)[f.fieldType];
export const rhDocUrl = (id: string) => 'https://www.runninghub.ai/zh-cn/call-api/api-detail/' + id + '?apiType=4';
export function parseAppId(value: string) {
  const input = value.trim();
  if (/^\d{1,25}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && /^(www\.)?runninghub\.(ai|cn)$/.test(url.hostname)) {
      const match = url.pathname.match(/\/(?:ai-detail|api-detail)\/(\d{1,25})\/?$/);
      if (match) return match[1];
    }
  } catch { /* show one actionable error */ }
  throw new Error('请输入 RunningHub 应用 ID 或应用 / API 文档链接');
}
export function cleanRHSchema(raw: any): RHSchema {
  if (!raw || typeof raw.appId !== 'string' || !/^\d{1,25}$/.test(raw.appId) || !Array.isArray(raw.fields) || raw.fields.length > 100) throw new Error('RunningHub 参数文档无效');
  const keys = new Set<string>();
  const fields = raw.fields.map((f: any) => {
    if (!f || !/^\d+$/.test(f.nodeId) || typeof f.fieldName !== 'string' || !f.fieldName || f.fieldName.length > 200) throw new Error('RunningHub 字段无效');
    const field: RHField = { nodeId: String(f.nodeId), fieldName: f.fieldName, fieldType: String(f.fieldType).toUpperCase(), fieldValue: String(f.fieldValue ?? ''), fieldData: String(f.fieldData || ''), label: String(f.label || f.fieldName) };
    if (keys.has(rhPort(field))) throw new Error('RunningHub 字段重复');
    keys.add(rhPort(field)); return field;
  });
  return { appId: raw.appId, title: String(raw.title || 'RunningHub 应用'), fields };
}
export function rhFieldOptions(field: RHField): { options?: string[]; min?: number; max?: number; step?: number } {
  try {
    const parsed = JSON.parse(field.fieldData);
    const spec = Array.isArray(parsed) && parsed[1] && !Array.isArray(parsed[1]) ? parsed[1] : {};
    const list = spec.options || (Array.isArray(parsed[0]) ? parsed[0] : Array.isArray(parsed) && parsed.every(v => v && typeof v === 'object') ? parsed : []);
    return { ...spec, options: list.map((v: any) => String(typeof v === 'object' ? v.name ?? v.index : v)).filter((v: string) => v !== 'undefined') };
  } catch { return {}; }
}
export function rhValues(data: NodeData): Record<string, string> {
  return Object.fromEntries((data.rhSchema?.fields || []).map(f => [rhPort(f), data.rhValues?.[rhPort(f)] ?? f.fieldValue]));
}
