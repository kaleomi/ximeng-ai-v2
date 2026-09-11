/**
 * 工作流执行引擎
 * - 从 document 读取节点/连线
 * - 拓扑排序确定执行顺序
 * - 串行执行：每个节点调 API，结果通过 getFormModel 写回 node data
 * - 上游结果可作为下游节点的参考（图片→视频图生视频）
 */
import type { WorkflowDocument } from '@flowgram.ai/free-layout-editor';
import { getFormModel } from '@flowgram.ai/form-core';

interface ExecNode {
  id: string;
  type: string;
  data: Record<string, any>;
}

type NodeStatus = 'idle' | 'processing' | 'completed' | 'error';

function apiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = localStorage.getItem('ai_media_api_key');
  const baseUrl = localStorage.getItem('ai_media_base_url');
  if (apiKey) headers['x-api-key'] = apiKey;
  if (baseUrl) headers['x-base-url'] = baseUrl;
  return headers;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取节点 data（通过 form model） */
function readNodeData(doc: WorkflowDocument, id: string): Record<string, any> {
  const node = doc.getNode(id);
  if (!node) return {};
  try {
    const form = getFormModel(node) as any;
    return form?.getValueIn('') || form?.getValues?.() || {};
  } catch {
    // fallback: 从 node 直接读
    return (node as any).getJSONData?.()?.data || {};
  }
}

/** 写入节点 data 的某个字段（通过 form model） */
function setNodeValue(doc: WorkflowDocument, id: string, name: string, value: unknown) {
  const node = doc.getNode(id);
  if (!node) return;
  try {
    const form = getFormModel(node) as any;
    if (form?.setValueIn) form.setValueIn(name, value);
  } catch {
    // ignore
  }
}

/** 拓扑排序：返回按依赖顺序排列的节点 id 列表；有环时返回 null */
function topoSort(nodes: ExecNode[], edges: { sourceNodeID: string; targetNodeID: string }[]): string[] | null {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  });
  edges.forEach((e) => {
    if (!indegree.has(e.sourceNodeID) || !indegree.has(e.targetNodeID)) return;
    adj.get(e.sourceNodeID)!.push(e.targetNodeID);
    indegree.set(e.targetNodeID, (indegree.get(e.targetNodeID) || 0) + 1);
  });
  const queue: string[] = [];
  indegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) || []) {
      const d = (indegree.get(next) || 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order.length === nodes.length ? order : null;
}

/** 收集某节点的所有上游（前置）节点结果 */
function collectUpstreamResults(
  nodeId: string,
  nodes: ExecNode[],
  edges: { sourceNodeID: string; targetNodeID: string }[],
  results: Map<string, Record<string, any>>
): Record<string, any> {
  const upstream: Record<string, any> = {};
  edges.forEach((e) => {
    if (e.targetNodeID === nodeId) {
      const src = results.get(e.sourceNodeID);
      if (src) upstream[e.sourceNodeID] = src;
    }
  });
  return upstream;
}

/** 从上游结果中提取 prompt（文本节点输出，作为下游生成节点数据源） */
function resolvePrompt(data: Record<string, any>, upstream: Record<string, any>): string {
  if (data.prompt && String(data.prompt).trim()) return String(data.prompt);
  for (const key of Object.keys(upstream)) {
    const u = upstream[key];
    if (u.type === 'text' && u.output) return String(u.output);
    if (u.output && typeof u.output === 'string') return String(u.output);
  }
  return '';
}

/** 执行单个文本节点 */
async function runTextNode(node: ExecNode, doc: WorkflowDocument): Promise<void> {
  const text = node.data.text || '';
  if (!text.trim()) {
    setNodeValue(doc, node.id, 'status', 'error');
    return;
  }
  setNodeValue(doc, node.id, 'status', 'completed');
  setNodeValue(doc, node.id, 'output', text);
}

/** 执行单个图片生成节点 */
async function runImageNode(
  node: ExecNode,
  doc: WorkflowDocument,
  upstream: Record<string, any>
): Promise<void> {
  const prompt = resolvePrompt(node.data, upstream);
  if (!prompt.trim()) {
    setNodeValue(doc, node.id, 'status', 'error');
    return;
  }
  setNodeValue(doc, node.id, 'status', 'processing');
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
      body: JSON.stringify({
        model: node.data.model || 'doubao-seedream-5-0-260128',
        prompt,
        size: node.data.size || '1024x1024',
        n: node.data.n || 1,
      }),
    });
    const json = await res.json();
    if (json.ok && json.url) {
      setNodeValue(doc, node.id, 'status', 'completed');
      setNodeValue(doc, node.id, 'imageUrl', json.url);
      setNodeValue(doc, node.id, 'output', json.url);
      // 打通主站历史
      saveToMainHistory({
        type: 'image',
        model: node.data.model || 'doubao-seedream-5-0-260128',
        prompt,
        src: json.url,
        images: json.images || [json.url],
      });
    } else {
      setNodeValue(doc, node.id, 'status', 'error');
    }
  } catch (e) {
    setNodeValue(doc, node.id, 'status', 'error');
  }
}

/** 执行单个视频生成节点（含异步轮询） */
async function runVideoNode(
  node: ExecNode,
  doc: WorkflowDocument,
  upstream: Record<string, any>
): Promise<void> {
  const prompt = resolvePrompt(node.data, upstream);
  if (!prompt.trim()) {
    setNodeValue(doc, node.id, 'status', 'error');
    return;
  }
  setNodeValue(doc, node.id, 'status', 'processing');
  try {
    // 取上游图片作为参考图（图生视频）
    let refImage: string | undefined;
    for (const key of Object.keys(upstream)) {
      const u = upstream[key];
      if (u.imageUrl) {
        refImage = u.imageUrl;
        break;
      }
    }
    const res = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
      body: JSON.stringify({
        model: node.data.model || 'doubao-seedance-2.5',
        prompt,
        duration: node.data.duration || 5,
        flavor: 'ark',
        refImage,
      }),
    });
    const json = await res.json();
    if (!json.ok || !json.taskId) {
      setNodeValue(doc, node.id, 'status', 'error');
      return;
    }
    // 轮询
    let attempts = 0;
    while (attempts < 120) {
      await sleep(3000);
      attempts++;
      try {
        const sRes = await fetch(`/api/video-status/${json.taskId}`, {
          headers: { ...apiAuthHeaders() },
        });
        const sJson = await sRes.json();
        if (sJson.ok && sJson.status === 'succeeded') {
          setNodeValue(doc, node.id, 'status', 'completed');
          setNodeValue(doc, node.id, 'videoUrl', sJson.url);
          setNodeValue(doc, node.id, 'output', sJson.url);
          // 打通主站历史
          saveToMainHistory({
            type: 'video',
            model: node.data.model || 'doubao-seedance-2.5',
            prompt,
            src: sJson.url,
          });
          return;
        }
        if (sJson.status === 'failed' || sJson.status === 'error') {
          setNodeValue(doc, node.id, 'status', 'error');
          return;
        }
      } catch {
        // 继续轮询
      }
    }
    setNodeValue(doc, node.id, 'status', 'error');
  } catch (e) {
    setNodeValue(doc, node.id, 'status', 'error');
  }
}

export interface ExecuteCallbacks {
  onNodeStart?: (id: string) => void;
  onNodeDone?: (id: string, ok: boolean) => void;
  onFinished?: (ok: boolean) => void;
  onLog?: (msg: string) => void;
}

/**
 * 运行整个工作流
 * @param doc FlowGram document
 * @param cbs 回调（进度/日志）
 */
export async function executeWorkflow(
  doc: WorkflowDocument,
  cbs?: ExecuteCallbacks
): Promise<boolean> {
  let json: any;
  try {
    json = doc.toJSON();
  } catch {
    json = { nodes: [], edges: [] };
  }
  const nodes: ExecNode[] = json.nodes || [];
  const edges: { sourceNodeID: string; targetNodeID: string }[] = json.edges || [];

  if (!nodes.length) {
    cbs?.onLog?.('工作流为空，无节点可执行');
    cbs?.onFinished?.(true);
    return true;
  }

  const order = topoSort(nodes, edges);
  if (!order) {
    cbs?.onLog?.('工作流存在循环依赖，无法执行');
    cbs?.onFinished?.(false);
    return false;
  }

  const nodeMap = new Map<string, ExecNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));
  const results = new Map<string, Record<string, any>>();
  const execNodes = order.map((id) => nodeMap.get(id)!).filter(Boolean);

  let allOk = true;
  for (const n of execNodes) {
    const upstream = collectUpstreamResults(n.id, nodes, edges, results);
    // 刷新节点最新数据
    n.data = { ...n.data, ...readNodeData(doc, n.id) };
    results.set(n.id, { id: n.id, type: n.type, ...n.data });
    cbs?.onLog?.(`▶ 执行 ${n.type} 节点`);
    cbs?.onNodeStart?.(n.id);
    try {
      if (n.type === 'text') {
        await runTextNode(n, doc);
      } else if (n.type === 'image-generate') {
        await runImageNode(n, doc, upstream);
      } else if (n.type === 'video-generate') {
        await runVideoNode(n, doc, upstream);
      } else {
        setNodeValue(doc, n.id, 'status', 'completed');
      }
    } catch (e) {
      setNodeValue(doc, n.id, 'status', 'error');
    }
    const d = readNodeData(doc, n.id);
    const status = d.status || 'idle';
    results.set(n.id, { ...results.get(n.id), ...d });
    if (status === 'completed') {
      cbs?.onLog?.(`  ✓ ${n.type} 完成`);
      cbs?.onNodeDone?.(n.id, true);
    } else {
      allOk = false;
      cbs?.onLog?.(`  ✗ ${n.type} 失败`);
      cbs?.onNodeDone?.(n.id, false);
    }
  }

  cbs?.onLog?.(allOk ? '🎉 工作流执行完成' : '⚠️ 工作流执行完成(有节点失败)');
  cbs?.onFinished?.(allOk);
  return allOk;
}

/** 重置所有节点的执行状态（重新运行前调用） */
export function resetWorkflowStatus(doc: WorkflowDocument) {
  let json: any;
  try {
    json = doc.toJSON();
  } catch {
    json = { nodes: [], edges: [] };
  }
  (json.nodes || []).forEach((n: { id: string }) => {
    setNodeValue(doc, n.id, 'status', 'idle');
  });
}

/** 把生成结果写入主站历史记录（与主站共用 localStorage） */
export function saveToMainHistory(entry: Record<string, unknown>) {
  try {
    const key = 'ai_media_history';
    const list: unknown[] = JSON.parse(localStorage.getItem(key) || '[]');
    list.unshift({ ...entry, ts: Date.now() });
    if (list.length > 50) list.length = 50;
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // ignore
  }
}

