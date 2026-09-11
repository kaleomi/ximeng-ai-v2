import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { cleanRHSchema, rhPort, rhType, RHSchema } from './runninghub';
export type PortType = 'text' | 'image' | 'video' | 'audio' | 'media' | 'flow';
export interface NodeData {
  rhSchema?: RHSchema; rhValues?: Record<string, string>; audioUrl?: string;
  title?: string; text?: string; prompt?: string; model?: string; size?: string;
  quality?: string; count?: number; duration?: number; ratio?: string;
  image?: string; imageUrl?: string; videoUrl?: string; images?: string[];
  filename?: string; preview?: string; output?: string; error?: string;
  status?: 'idle' | 'uploading' | 'processing' | 'completed' | 'error' | 'skipped';
}
export const NODE_CATALOG = [
  { type: 'text', title: '提示词', subtitle: '编写文字描述', icon: 'T', color: '#c5a6f7', group: '输入', inputs: [] as PortType[], output: 'text' as PortType, defaults: { text: '' } },
  { type: 'image-upload', title: '上传图片', subtitle: '参考图 · 拖入或粘贴', icon: '▧', color: '#79c8b5', group: '输入', inputs: [] as PortType[], output: 'image' as PortType, defaults: {} },
  { type: 'image-generate', title: '图片生成', subtitle: '文生图 · 图生图', icon: '✦', color: '#9cabfb', group: '生成', inputs: ['text', 'image'] as PortType[], output: 'image' as PortType, defaults: { prompt: '', model: 'doubao-seedream-5-0-260128', size: '1024x1024', quality: 'auto', count: 1 } },
  { type: 'video-generate', title: '视频生成', subtitle: '文生视频 · 图生视频', icon: '▷', color: '#e5bd83', group: '生成', inputs: ['text', 'image'] as PortType[], output: 'video' as PortType, defaults: { prompt: '', model: 'doubao-seedance-2.5', ratio: '16:9', quality: '720P', duration: 5, count: 1 } },
  { type: 'preview', title: '预览结果', subtitle: '预览并继续传递结果', icon: '▣', color: '#85bce8', group: '输出', inputs: ['media'] as PortType[], output: undefined, defaults: {} },
];
export const RH_DEFINITION = { type: 'runninghub', title: 'RunningHub 应用', subtitle: '从应用 ID 导入', icon: 'R', color: '#90b9fb', group: '生成', inputs: [] as PortType[], output: undefined, defaults: {} };
export const RESULT_DEFINITION = { ...RH_DEFINITION, type: 'result', title: '历史结果', icon: '▣' };
export const getDefinition = (type: string) => type === 'result' ? RESULT_DEFINITION : type === 'runninghub' ? RH_DEFINITION : NODE_CATALOG.find((item) => item.type === type);
export function inputPorts(node: GraphNode): string[] { return node.type === 'runninghub' ? (node.data?.rhSchema?.fields || []).filter(rhType).map(rhPort) : getDefinition(String(node.type))?.inputs || ['flow']; }
export function outputPorts(node: GraphNode): string[] { return ['runninghub', 'preview', 'result'].includes(String(node.type)) ? ['image', 'video', 'audio', 'text'] : [getDefinition(String(node.type))?.output || 'flow']; }
export function inputType(node: GraphNode | undefined, port: string): string { return port.startsWith('rh:') ? rhType(node?.data?.rhSchema?.fields?.find((f: any) => rhPort(f) === port) || { fieldType: '' }) || '' : port; }

export function newNodeData(type: string): NodeData {
  const definition = getDefinition(type);
  return { title: definition?.title, ...definition?.defaults, status: 'idle' };
}
export const portLabel: Record<PortType, string> = { text: '提示词', image: '图片', video: '视频', audio: '音频', media: '结果输入', flow: '流程' };
export const portColor: Record<PortType, string> = { text: '#c5a6f7', image: '#79c8b5', video: '#e5bd83', audio: '#e89ebe', media: '#85bce8', flow: '#89909e' };
export type GraphNode = NonNullable<WorkflowJSON['nodes']>[number];
export type GraphEdge = NonNullable<WorkflowJSON['edges']>[number];
const stringFields = ['title', 'text', 'prompt', 'model', 'size', 'quality', 'ratio', 'image', 'imageUrl', 'videoUrl', 'filename', 'output', 'audioUrl'] as const;
function cleanNodeData(raw: Record<string, unknown>): NodeData {
  const data: NodeData = {};
  if (raw.rhSchema !== undefined) {
    data.rhSchema = cleanRHSchema(raw.rhSchema);
    const values = raw.rhValues as Record<string, unknown> | undefined;
    data.rhValues = Object.fromEntries(data.rhSchema.fields.map(f => { const value = values?.[rhPort(f)] ?? f.fieldValue; if (typeof value !== 'string') throw new Error('RunningHub 字段值无效'); return [rhPort(f), value]; }));
  }
  for (const key of stringFields) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'string') throw new Error('节点字段格式错误：' + key);
    data[key] = raw[key];
  }
  for (const key of ['count', 'duration'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || raw[key] < 1 || raw[key] > (key === 'count' ? 4 : 15)) throw new Error('节点参数无效：' + key);
    data[key] = raw[key];
  }
  if (raw.images !== undefined) {
    if (!Array.isArray(raw.images) || raw.images.some((url) => typeof url !== 'string')) throw new Error('图片结果必须是链接数组');
    data.images = raw.images;
  }
  for (const url of [data.image, data.imageUrl, data.videoUrl, data.audioUrl, ...(data.images || [])]) {
    if (url && !/^(https?:\/\/|data:(image\/(png|jpeg|webp|gif|bmp)|video\/mp4);base64,)/i.test(url)) throw new Error('图片或视频链接格式无效');
  }
  return data;
}
export function topologicalOrder(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  const next = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const edge of edges) {
    if (!degree.has(edge.sourceNodeID) || !degree.has(edge.targetNodeID)) throw new Error('连线引用了不存在的节点');
    next.get(edge.sourceNodeID)!.push(edge.targetNodeID);
    degree.set(edge.targetNodeID, degree.get(edge.targetNodeID)! + 1);
  }
  const queue = nodes.filter((n) => degree.get(n.id) === 0).map((n) => n.id);
  for (let i = 0; i < queue.length; i++) {
    for (const id of next.get(queue[i])!) {
      degree.set(id, degree.get(id)! - 1);
      if (degree.get(id) === 0) queue.push(id);
    }
  }
  if (queue.length !== nodes.length) throw new Error('存在循环连线，请断开回路后再运行');
  return queue;
}
export function connectionError(graph: WorkflowJSON, source: string, target: string, sourcePort: string, targetPort: string): string | undefined {
  if (source === target) return '不能连接到节点自身';
  const targetType = inputType(graph.nodes?.find(n => n.id === target), targetPort);
  if (!(sourcePort === targetType || (targetType === 'media' && ['image', 'video', 'audio', 'text'].includes(sourcePort)) || sourcePort === 'flow' || targetPort === 'flow')) return '请连接相同类型的端口';
  const edges = graph.edges || [];
  if (edges.some((e) => e.targetNodeID === target && String(e.targetPortID) === targetPort)) return '这个输入已连接，请先选中旧连线并删除';
  try { topologicalOrder(graph.nodes || [], [...edges, { sourceNodeID: source, targetNodeID: target }]); }
  catch { return '这条连线会形成循环'; }
}
/** Validate imports and upgrade previous unnamed ports. */
export function normalizeWorkflow(raw: unknown): WorkflowJSON {
  const graph = raw as WorkflowJSON;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('请选择有效的熙梦工作流 JSON 文件');
  if (graph.nodes.length > 500 || graph.edges.length > 2000) throw new Error('工作流过大（最多 500 个节点）');
  const ids = new Set<string>();
  const nodes = graph.nodes.map((n) => {
    const type = ({ imagegenerate: 'image-generate', videogenerate: 'video-generate' } as Record<string, string>)[String(n.type)] || String(n.type);
    if (!n.id || typeof n.id !== 'string' || ids.has(n.id)) throw new Error('节点 ID 缺失或重复');
    ids.add(n.id);
    if (!getDefinition(type) && !['start', 'end'].includes(type)) throw new Error('不支持的节点类型：' + type);
    if (n.meta?.position && (!Number.isFinite(n.meta.position.x) || !Number.isFinite(n.meta.position.y))) throw new Error('节点坐标无效');
    const data: NodeData = { ...getDefinition(type)?.defaults, ...cleanNodeData(n.data || {}) };
    delete data.preview;
    data.status = 'idle';
    data.error = '';
    return { id: n.id, meta: { position: n.meta?.position || { x: 100, y: 100 } }, type, data };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const source = byId.get(e.sourceNodeID), target = byId.get(e.targetNodeID);
    if (!source || !target) throw new Error('连线引用了不存在的节点');
    const output = outputPorts(source)[0];
    const inputs = inputPorts(target);
    const sourcePortID = String(e.sourcePortID || output);
    const targetPortID = String(e.targetPortID || (inputs.includes(output) ? output : inputs.includes('media') ? 'media' : 'flow'));
    if (!outputPorts(source).includes(sourcePortID) && sourcePortID !== 'flow') throw new Error('输出端口不存在');
    if (!inputs.includes(targetPortID as PortType) && targetPortID !== 'flow') throw new Error('输入端口不存在');
    const error = connectionError({ nodes, edges }, source.id, target.id, sourcePortID, targetPortID);
    if (error) throw new Error(error);
    edges.push({ ...e, sourcePortID, targetPortID });
  }
  topologicalOrder(nodes, edges);
  return { nodes, edges };
}
