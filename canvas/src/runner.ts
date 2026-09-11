import { rhPort, rhType, rhValues, cleanRHSchema, rhFieldOptions } from './runninghub';
import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { NodeData, inputType, getDefinition, topologicalOrder, GraphNode, GraphEdge } from './workflow';
import { apiRequest } from './api';
export interface RunCallbacks {
  onNodeStart?: (id: string) => void;
  onNodeDone?: (id: string, ok: boolean) => void;
  onFinished?: (ok: boolean) => void;
  onLog?: (message: string) => void;
  update: (id: string, patch: Partial<NodeData>) => void;
  onResult?: (entry: Record<string, unknown>) => void;
}
type Request = (path: string, init?: RequestInit) => Promise<any>;
export interface RunOptions { signal?: AbortSignal; request?: Request; pollInterval?: number; pollAttempts?: number; nodeId?: string; }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('已停止运行', 'AbortError'); }
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    checkAbort(signal);
    const abort = () => { clearTimeout(timer); reject(new DOMException('已停止运行', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function inputsFor(node: GraphNode, edges: GraphEdge[], results: Map<string, NodeData>) {
  let prompt = '', inheritedPrompt = '', image = '', media: NodeData | undefined;
  for (const edge of edges.filter((e) => e.targetNodeID === node.id)) {
    const result = results.get(edge.sourceNodeID);
    if (!result) continue;
    if (edge.targetPortID === 'text') prompt = result.text || result.prompt || '';
    if (edge.targetPortID === 'image') { image = result.imageUrl || result.image || ''; inheritedPrompt = result.prompt || ''; }
    if (edge.targetPortID === 'media') media = result;
    // Legacy unnamed/control edges carry compatible upstream data only.
    if (!edge.targetPortID || edge.targetPortID === 'flow') {
      if (!prompt) prompt = result.text || result.prompt || '';
      if (!image) image = result.imageUrl || result.image || '';
    }
  }
  return { prompt, inheritedPrompt, image, media };
}
function preflight(nodes: GraphNode[], edges: GraphEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasPrompt = (id: string, visited = new Set<string>()): boolean => {
    if (visited.has(id)) return false;
    visited.add(id);
    const source = byId.get(id);
    if (source?.data?.text?.trim() || source?.data?.prompt?.trim()) return true;
    return edges.some((edge) => edge.targetNodeID === id && hasPrompt(edge.sourceNodeID, new Set(visited)));
  };
  for (const n of nodes) {
    const data: NodeData = n.data || {};
    const name = data.title || getDefinition(String(n.type))?.title || n.type;
    if (data.status === 'uploading') throw new Error(name + '：请等待图片上传完成');
    if (n.type === 'text' && !data.text?.trim()) throw new Error(name + '：请输入提示词');
    if (n.type === 'image-upload' && !/^https?:\/\//i.test(data.imageUrl || data.image || '')) throw new Error(name + '：请上传图片或填写有效图片链接');
    if (['image-generate', 'video-generate'].includes(String(n.type)) && !data.prompt?.trim()) {
      if (!hasPrompt(n.id)) throw new Error(name + '：请连接提示词或在节点里输入描述');
    }
    if (n.type === 'preview' && !edges.some((e) => e.targetNodeID === n.id && e.targetPortID === 'media')) throw new Error(name + '：请连接图片或视频输出');
  }
}
/** Single-node execution reads existing upstream outputs, never reruns upstream APIs. */
function prepareSingleNode(target: GraphNode, nodes: GraphNode[], edges: GraphEdge[], results: Map<string, NodeData>) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges.filter((e) => e.targetNodeID === target.id)) {
    const source = byId.get(edge.sourceNodeID);
    if (!source) throw new Error('连线引用了不存在的节点');
    const data: NodeData = source.data || {};
    const name = data.title || getDefinition(String(source.type))?.title || source.id;
    if (data.status === 'processing' || data.status === 'uploading') throw new Error('请等待「' + name + '」完成后再运行此节点');
    if (source.type === 'image-upload' && !/^https?:\/\//i.test(data.imageUrl || data.image || '')) throw new Error('「' + name + '」没有有效的图片，请先上传或填写图片链接');
    const output: NodeData = source.type === 'text'
      ? { text: data.text || '', prompt: data.text || '', output: data.text || '' }
      : source.type === 'image-upload'
        ? { imageUrl: data.imageUrl || data.image, image: data.imageUrl || data.image, output: data.imageUrl || data.image }
        : { imageUrl: data.imageUrl || data.images?.[0], images: data.images, videoUrl: data.videoUrl, prompt: data.prompt, text: data.text, audioUrl: data.audioUrl, output: data.output };
    const port = inputType(target, String(edge.targetPortID || 'flow'));
    if (port === 'audio' && !output.audioUrl) throw new Error('「' + name + '」还没有音频结果');
    if (port === 'video' && !output.videoUrl) throw new Error('「' + name + '」还没有视频结果');
    if (port === 'text' && !output.text?.trim() && !output.prompt?.trim()) throw new Error('「' + name + '」没有提示词，请先填写');
    if (port === 'image' && !output.imageUrl) throw new Error('「' + name + '」还没有图片结果，请先运行该节点或上传图片');
    if (port === 'media' && !output.imageUrl && !output.videoUrl && !output.audioUrl && !output.text) throw new Error('「' + name + '」还没有可用结果，请先运行该节点');
    if (port === 'flow' && !['text', 'image-upload', 'start', 'end'].includes(String(source.type)) && !output.imageUrl && !output.videoUrl) throw new Error('「' + name + '」还没有可用结果，请先运行该节点');
    results.set(source.id, output);
  }
  const inputs = inputsFor(target, edges, results);
  const data: NodeData = target.data || {};
  if (data.status === 'uploading') throw new Error('请等待当前节点的图片上传完成');
  if (target.type === 'text' && !data.text?.trim()) throw new Error('请输入提示词');
  if (target.type === 'image-upload' && !/^https?:\/\//i.test(data.imageUrl || data.image || '')) throw new Error('请先上传图片或填写有效图片链接');
  if (['image-generate', 'video-generate'].includes(String(target.type)) && !inputs.prompt.trim() && !data.prompt?.trim() && !inputs.inheritedPrompt.trim()) throw new Error('请连接提示词或在当前节点里输入描述');
  if (target.type === 'preview' && !inputs.media?.imageUrl && !inputs.media?.videoUrl && !inputs.media?.audioUrl && !inputs.media?.text) throw new Error('请连接已经生成的结果');
}
/** Run an immutable graph snapshot. A failed dependency never feeds stale output downstream. */
export async function executeGraph(graph: WorkflowJSON, callbacks: RunCallbacks, options: RunOptions = {}): Promise<boolean> {
  const nodes = graph.nodes || [], edges = graph.edges || [];
  const request = options.request || apiRequest;
  const results = new Map<string, NodeData>(), failed = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let allOk = true;
  let active: string | undefined;
  try {
    if (!nodes.length) throw new Error('画布为空，请先添加节点');
    let order: string[];
    if (options.nodeId !== undefined) {
      const target = byId.get(options.nodeId);
      if (!target) throw new Error('要运行的节点不存在');
      active = target.id;
      prepareSingleNode(target, nodes, edges, results);
      order = [target.id];
      callbacks.onLog?.('仅运行当前节点，使用已连接节点的现有结果');
    } else {
      order = topologicalOrder(nodes, edges);
      preflight(nodes, edges);
    }
    checkAbort(options.signal);
    // Preserve all cached results during single-node runs, including the last successful result on retry.
    if (options.nodeId === undefined) for (const n of nodes) callbacks.update(n.id, { status: 'idle', error: '', ...(!['image-upload', 'result'].includes(String(n.type)) ? { imageUrl: '', videoUrl: '', images: [], output: '' } : {}) });
    for (const id of order) {
      checkAbort(options.signal);
      const n = byId.get(id)!;
      const data: NodeData = { ...getDefinition(String(n.type))?.defaults, ...n.data };
      const name = data.title || getDefinition(String(n.type))?.title || String(n.type);
      if (edges.some((e) => e.targetNodeID === id && failed.has(e.sourceNodeID))) {
        callbacks.update(id, { status: 'skipped', error: '上游节点失败，已跳过' });
        callbacks.onLog?.('跳过 ' + name + '：上游节点失败');
        failed.add(id); allOk = false; continue;
      }
      active = id;
      callbacks.update(id, { status: 'processing', error: '' });
      callbacks.onNodeStart?.(id);
      callbacks.onLog?.('运行 ' + name);
      try {
        const inputs = inputsFor(n, edges, results);
        const prompt = inputs.prompt.trim() || data.prompt?.trim() || inputs.inheritedPrompt.trim() || '';
        const image = inputs.image || data.image || '';
        let result: NodeData = {};
        if (n.type === 'text') result = { text: data.text, prompt: data.text, output: data.text };
        else if (n.type === 'image-upload') result = { imageUrl: data.imageUrl || data.image, image: data.imageUrl || data.image, output: data.imageUrl || data.image };
        else if (n.type === 'image-generate') {
          if (!prompt) throw new Error('请输入提示词或连接有效的提示词节点');
          const response = await request('/api/generate-image', {
            method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, params: { model: data.model, size: data.size, quality: data.quality, n: data.count || 1, ...(image ? { image } : {}) } }),
          });
          const images: string[] = (response.images?.length ? response.images : response.url ? [response.url] : response.b64 ? ['data:image/png;base64,' + response.b64] : []).filter((url: unknown) => typeof url === 'string' && /^(https?:\/\/|data:image\/)/i.test(url));
          if (!images.length) throw new Error('生成服务未返回图片');
          result = { prompt, imageUrl: images[0], images, output: images[0] };
          callbacks.onResult?.({ type: 'image', model: data.model, prompt, src: images[0], images });
        } else if (n.type === 'video-generate') {
          if (!prompt) throw new Error('请输入视频描述或连接提示词节点');
          let response = await request('/api/generate-video', {
            method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, flavor: 'ark', params: { model: data.model, duration: data.duration, ratio: data.ratio, quality: data.quality, count: data.count || 1, ...(image ? { refImage: image } : {}) } }),
          });
          const taskId = response.taskId;
          const flavor = response.flavor || 'ark';
          let attempts = 0;
          while (!response.url && !response.b64 && response.status !== 'succeeded') {
            if (['failed', 'error', 'canceled', 'cancelled'].includes(response.status)) throw new Error(response.error || '视频生成失败');
            if (!taskId) throw new Error('视频服务未返回任务编号或视频结果');
            if (++attempts > (options.pollAttempts ?? 120)) throw new Error('视频等待超时，请在主站检查任务结果');
            await wait(options.pollInterval ?? 3000, options.signal);
            response = await request('/api/video-status/' + encodeURIComponent(taskId) + '?flavor=' + encodeURIComponent(flavor), { signal: options.signal });
          }
          const videoUrl = response.url || (response.b64 ? 'data:video/mp4;base64,' + response.b64 : '');
          if (!videoUrl || !/^(https?:\/\/|data:video\/)/i.test(videoUrl)) throw new Error('视频服务未返回有效视频地址');
          result = { prompt, videoUrl, output: videoUrl };
          callbacks.onResult?.({ type: 'video', model: data.model, flavor, prompt, src: videoUrl });
        } else if (n.type === 'runninghub') {
          const schema = cleanRHSchema(data.rhSchema);
          const values = rhValues(data);
          for (const field of schema.fields) {
            const key = rhPort(field), type = rhType(field);
            const edge = edges.find(e => e.targetNodeID === id && e.targetPortID === key);
            if (edge) {
              const upstream = results.get(edge.sourceNodeID);
              const value = type === 'image' ? upstream?.imageUrl : type === 'video' ? upstream?.videoUrl : type === 'audio' ? upstream?.audioUrl : upstream?.text || upstream?.prompt;
              if (!value) throw new Error(field.label + ' #' + field.nodeId + '：连接的上游没有对应结果');
              values[key] = value;
            }
            if (['INT', 'FLOAT'].includes(field.fieldType)) {
              const number = Number(values[key]), spec = rhFieldOptions(field);
              if (!values[key].trim() || !Number.isFinite(number) || (field.fieldType === 'INT' && !Number.isInteger(number)) || (spec.min !== undefined && number < spec.min) || (spec.max !== undefined && number > spec.max)) throw new Error(field.label + ' #' + field.nodeId + '：数值超出允许范围');
            }
          }
          let response = await request('/api/generate-video', {
            method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flavor: 'runninghub', params: { appId: schema.appId, nodeInfoList: schema.fields.map(f => ({ nodeId: f.nodeId, fieldName: f.fieldName, fieldValue: values[rhPort(f)] })) } }),
          });
          const taskId = response.taskId;
          let attempts = 0;
          while (response.status !== 'succeeded') {
            if (['failed', 'error', 'canceled', 'cancelled'].includes(response.status)) throw new Error(response.error || 'RunningHub 运行失败');
            if (!taskId) throw new Error('RunningHub 未返回任务编号');
            if (++attempts > (options.pollAttempts ?? 600)) throw new Error('等待超时，请到 RunningHub 查看任务：' + taskId);
            await wait(options.pollInterval ?? 3000, options.signal);
            response = await request('/api/video-status/' + encodeURIComponent(taskId) + '?flavor=runninghub', { signal: options.signal });
          }
          const outputs = response.results || response.upstream?.results || [];
          const images: string[] = [];
          let videoUrl = '', audioUrl = '', text = '';
          for (const output of outputs) {
            const url = typeof output.url === 'string' && /^https?:\/\//i.test(output.url) ? output.url : '';
            const kind = String(output.outputType || '').toLowerCase();
            if (output.text) text += (text ? '\n' : '') + output.text;
            if (!url) continue;
            if (/^(video|mp4|webm|mov)$/.test(kind) || /\.(mp4|webm|mov)(\?|$)/i.test(url)) videoUrl ||= url;
            else if (/^(audio|mp3|wav|ogg|flac|m4a)$/.test(kind) || /\.(mp3|wav|ogg|flac|m4a)(\?|$)/i.test(url)) audioUrl ||= url;
            else if (/^(image|png|jpg|jpeg|webp|gif|bmp)$/.test(kind) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(url)) images.push(url);
          }
          if (!images.length && !videoUrl && !audioUrl && !text) throw new Error('RunningHub 未返回支持的图片、视频、音频或文本结果');
          result = { imageUrl: images[0] || '', images, videoUrl, audioUrl, text, output: images[0] || videoUrl || audioUrl || text };
          for (const [type, src] of [['image', images[0]], ['video', videoUrl], ['audio', audioUrl], ['text', text]]) {
            if (src) callbacks.onResult?.({ type, model: schema.title, flavor: 'runninghub', src, ...(type === 'image' ? { images } : {}) });
          }
        } else if (n.type === 'result') {
          if (!data.imageUrl && !data.videoUrl && !data.audioUrl && !data.text) throw new Error('历史结果已不可用');
          result = { ...data };
        } else if (n.type === 'preview') {
          if (!inputs.media?.imageUrl && !inputs.media?.videoUrl && !inputs.media?.audioUrl && !inputs.media?.text) throw new Error('上游没有可预览的结果');
          result = { ...inputs.media };
        } else if (!['start', 'end'].includes(String(n.type))) throw new Error('不支持的节点类型：' + n.type);
        checkAbort(options.signal);
        callbacks.update(id, { ...result, status: 'completed', error: '' });
        results.set(id, result);
        callbacks.onNodeDone?.(id, true);
        callbacks.onLog?.('完成 ' + name);
      } catch (error) {
        if (options.signal?.aborted || (error as Error).name === 'AbortError') throw error;
        const message = (error as Error).message;
        failed.add(id); allOk = false;
        callbacks.update(id, { status: 'error', error: message });
        callbacks.onNodeDone?.(id, false);
        callbacks.onLog?.(name + '失败：' + message);
      }
      active = undefined;
    }
    callbacks.onLog?.(allOk ? (options.nodeId !== undefined ? '当前节点运行完成，结果可继续连接下一个节点' : '工作流运行完成') : '运行结束，部分节点失败或已跳过');
  } catch (error) {
    allOk = false;
    const aborted = options.signal?.aborted || (error as Error).name === 'AbortError';
    const message = aborted ? '已停止后续执行；已提交的生成任务可能仍在服务端继续' : (error as Error).message;
    if (active) callbacks.update(active, { status: 'error', error: message });
    callbacks.onLog?.(message);
  } finally { callbacks.onFinished?.(allOk); }
  return allOk;
}
