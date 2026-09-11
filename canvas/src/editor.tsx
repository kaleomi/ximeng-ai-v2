import { HistoryPanel } from './components/history-panel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorRenderer, FreeLayoutEditorProvider, useClientContext, WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { useEditorProps } from './hooks/use-editor-props';
import { NodeAddPanel } from './components/node-add-panel';
import { Tools } from './components/tools';
import { Minimap } from './components/minimap';
import { executeWorkflow, resetWorkflowStatus } from './executor';
import { initialData } from './initial-data';
import { SAMPLE_WORKFLOW } from './sample-workflow';
import { NODE_CATALOG, normalizeWorkflow, newNodeData } from './workflow';
import { apiRequest, notify, queueImage, validateImage } from './api';
import { loadDraft, portableWorkflow, saveDraft } from './storage';
import '@flowgram.ai/free-layout-editor/index.css';
import './index.css';

function Studio() {
  const ctx = useClientContext();
  const graphDocument = ctx.document;
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState('本机自动保存');
  const [counts, setCounts] = useState({ nodes: graphDocument.toJSON().nodes?.length || 0, edges: graphDocument.toJSON().edges?.length || 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; position: { x: number; y: number } } | null>(null);
  const controller = useRef<AbortController>();
  const isRunning = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const fileMenu = useRef<HTMLDetailsElement>(null);
  const hasUploads = () => (graphDocument.toJSON().nodes || []).some((n) => n.data?.status === 'uploading');
  const addLog = (message: string) => setLogs((prev) => [...prev.slice(-79), message]);

  const persist = useCallback(async () => {
    try { await saveDraft(graphDocument.toJSON()); setSaved('已保存到本机'); }
    catch { setSaved('本机保存失败，请导出'); }
  }, [graphDocument]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let noticeTimer: ReturnType<typeof setTimeout>;
    const change = () => {
      const json = graphDocument.toJSON();
      setCounts({ nodes: json.nodes?.length || 0, edges: json.edges?.length || 0 });
      setSaved('正在保存…');
      clearTimeout(timer); timer = setTimeout(() => { void persist(); }, 250);
    };
    const onNotice = (e: Event) => {
      setNotice((e as CustomEvent<string>).detail);
      clearTimeout(noticeTimer); noticeTimer = setTimeout(() => setNotice(''), 5500);
    };
    const flush = () => { clearTimeout(timer); void persist(); };
    window.addEventListener('canvas-change', change);
    window.addEventListener('canvas-notice', onNotice);
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(timer); clearTimeout(noticeTimer); controller.current?.abort(); window.removeEventListener('canvas-change', change); window.removeEventListener('canvas-notice', onNotice); window.removeEventListener('pagehide', flush); };
  }, [graphDocument, persist]);

  const addImages = useCallback((files: File[], position?: { x: number; y: number }) => {
    if (isRunning.current) { notify('请在工作流停止后添加图片'); return; }
    let count = 0;
    files.slice(0, 20).forEach((file, index) => {
      try { validateImage(file); } catch (e) { notify((e as Error).message); return; }
      const id = 'upload_' + crypto.randomUUID();
      queueImage(id, file);
      const point = position ? { x: position.x + index * 35, y: position.y + index * 35 } : undefined;
      graphDocument.createWorkflowNodeByType('image-upload', point, { id, data: newNodeData('image-upload') });
      count++;
    });
    if (count) notify('已添加 ' + count + ' 个图片节点');
  }, [graphDocument]);

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable="true"]')) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); e.stopImmediatePropagation(); addImages(files); }
    };
    const keys = (e: KeyboardEvent) => {
      if (isRunning.current && (e.ctrlKey || e.metaKey) && ['z', 'y', 'v', 'x', 'd'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.key === 'Escape') { setMenu(null); if (fileMenu.current) fileMenu.current.open = false; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void persist(); notify('正在保存到本机'); }
    };
    window.addEventListener('paste', paste, true);
    window.addEventListener('keydown', keys, true);
    return () => { window.removeEventListener('paste', paste, true); window.removeEventListener('keydown', keys, true); };
  }, [addImages, persist]);

  const run = useCallback(async (nodeId?: string) => {
    if (isRunning.current) return;
    if (nodeId === undefined && (graphDocument.toJSON().nodes || []).some((n) => n.data?.status === 'uploading')) { notify('图片正在上传，请完成后再运行'); return; }
    isRunning.current = true;
    setRunning(true); setShowLogs(true); setLogs([]); setMenu(null);
    controller.current = new AbortController();
    ctx.playground.config.updateConfig({ readonly: true });
    try { await executeWorkflow(graphDocument, { onLog: (message) => setLogs((prev) => [...prev.slice(-79), message]) }, { signal: controller.current.signal, nodeId }); }
    catch (e) { addLog((e as Error).message); }
    finally { isRunning.current = false; setRunning(false); ctx.playground.config.updateConfig({ readonly: false }); void persist(); }
  }, [ctx, graphDocument, persist]);

  useEffect(() => {
    const runNode = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string') void run(id);
    };
    window.addEventListener('canvas-run-node', runNode);
    return () => window.removeEventListener('canvas-run-node', runNode);
  }, [run]);

  const replace = (json: unknown) => {
    if (isRunning.current || hasUploads()) { notify('请在运行和图片上传结束后加载工作流'); return; }
    const normalized = normalizeWorkflow(json);
    ctx.operation.fromJSON(normalized);
    void ctx.tools.fitView();
    notify('工作流已加载，可以通过撤销恢复');
    void persist();
  };
  const perform = async (action: () => void | Promise<void>) => {
    if (fileMenu.current) fileMenu.current.open = false;
    try { await action(); } catch (e) { notify((e as Error).message); }
  };
  const cloudSave = async () => {
    if (!localStorage.getItem('ai_media_auth')) { notify('请先通过主站登录，再使用云端保存'); return; }
    if (hasUploads()) { notify('请等待图片上传完成后保存'); return; }
    await apiRequest('/api/workflow/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: portableWorkflow(graphDocument.toJSON()) }) });
    notify('已保存到云端');
  };
  const cloudLoad = async () => {
    if (!localStorage.getItem('ai_media_auth')) { notify('请先通过主站登录，再加载云端工作流'); return; }
    const data = await apiRequest('/api/workflow/load');
    if (data.json) replace(data.json); else notify('还没有云端工作流');
  };
  const exportJson = () => {
    if (hasUploads()) { notify('请等待图片上传完成后导出'); return; }
    const blob = new Blob([JSON.stringify(portableWorkflow(graphDocument.toJSON()), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = '熙梦工作流-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('工作流已导出');
  };

  return <div className="studio" onPointerDown={() => setMenu(null)}>
    <header className="studio-header">
      <a className="studio-brand" href="/"><span className="brand-mark">✦</span>熙梦 AI</a>
      <div className="studio-title"><span>工作流画布</span><small aria-live="polite">{saved}</small></div>
      <div className="header-actions">
        <a className="back-link" href="/">返回主站 ↗</a>
        <details ref={fileMenu} className="file-menu"><summary>工作流 ▾</summary><div className="file-menu-items">
          <button disabled={running} onClick={() => void perform(() => replace({ nodes: [], edges: [] }))}>新建空白画布</button>
          <button disabled={running} onClick={() => void perform(() => replace(initialData))}>文生图示例</button>
          <button disabled={running} onClick={() => void perform(() => replace(SAMPLE_WORKFLOW))}>图片转视频示例</button>
          <button disabled={running} onClick={() => void perform(() => { importInput.current?.click(); })}>导入 JSON</button>
          <button onClick={() => void perform(exportJson)}>导出 JSON</button>
          <button onClick={() => void perform(cloudSave)}>保存到云端</button>
          <button disabled={running} onClick={() => void perform(cloudLoad)}>加载云端工作流</button>
        </div></details>
        <button onClick={() => { void persist(); notify('正在保存到本机'); }} title="保存到本机 Ctrl+S">保存</button>
        <button aria-pressed={showHistory} onClick={() => setShowHistory(v => !v)}>历史记录</button>
        <button onClick={() => setShowLogs((v) => !v)}>日志</button>
        <button disabled={running} onClick={() => { resetWorkflowStatus(graphDocument); notify('已重置节点状态'); }}>重置</button>
        {running ? <button className="run-button" onClick={() => controller.current?.abort()}>■ 停止</button> : <button className="run-button" onClick={() => void run()}>▶ 运行工作流</button>}
      </div>
      <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        void perform(async () => { if (file.size > 20 * 1024 * 1024) throw new Error('工作流文件不能超过 20 MB'); replace(JSON.parse(await file.text())); });
      }} />
    </header>
    <div className="studio-main">
      <NodeAddPanel running={running} />
      <main className="canvas-stage" aria-label="节点画布"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/ximeng-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={(e) => {
          e.preventDefault();
          if (isRunning.current) return;
          const position = ctx.playground.config.getPosFromMouseEvent(e, true);
          const nodeType = e.dataTransfer.getData('application/ximeng-node');
          if (NODE_CATALOG.some((n) => n.type === nodeType)) graphDocument.createWorkflowNodeByType(nodeType, position, { data: newNodeData(nodeType) });
          else addImages(Array.from(e.dataTransfer.files), position);
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.workflow-node,input,textarea,button,video')) return;
          e.preventDefault();
          if (!isRunning.current) setMenu({ x: Math.min(e.clientX, window.innerWidth - 225), y: Math.max(8, Math.min(e.clientY, window.innerHeight - 270)), position: ctx.playground.config.getPosFromMouseEvent(e, true) });
        }}>
        <EditorRenderer className="demo-free-editor" />
        <div className="canvas-footnote">{counts.nodes} 个节点 · {counts.edges} 条连线</div>
        {showHistory && <HistoryPanel running={running} onClose={() => setShowHistory(false)} />}
        <Tools running={running} /><Minimap />
        {showLogs && <section className="log-panel" aria-label="运行日志"><div className="log-header"><span>{running ? '工作流运行中' : '运行日志'}</span><button aria-label="关闭日志" onClick={() => setShowLogs(false)}>×</button></div><div className="log-entries" role="log">{logs.length ? logs.join('\n') : '连接节点后，点击「运行工作流」。'}</div></section>}
        {notice && <div className="canvas-toast" role="status">{notice}</div>}
      </main>
    </div>
    {menu && <div className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}><small>添加节点</small>{NODE_CATALOG.map((n) => <button key={n.type} onClick={() => { graphDocument.createWorkflowNodeByType(n.type, menu.position, { data: newNodeData(n.type) }); setMenu(null); }}>{n.icon}　{n.title}</button>)}</div>}
  </div>;
}
function LoadedEditor({ data }: { data: WorkflowJSON }) {
  const props = useEditorProps(data);
  return <FreeLayoutEditorProvider {...props}><Studio /></FreeLayoutEditorProvider>;
}
export function Editor() {
  const [data, setData] = useState<WorkflowJSON>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    loadDraft().then((draft) => { if (active) setData(draft || initialData); }).catch(() => { if (active) { setLoadError('本机草稿无法读取。当前画布不会覆盖旧草稿，完成后请导出 JSON。'); setData(initialData); } });
    return () => { active = false; };
  }, []);
  // A storage failure remains visible instead of claiming the draft was restored.
  return data ? <><LoadedEditor data={data} />{loadError && <div className="canvas-toast" role="alert" onClick={() => setLoadError('')}>{loadError}</div>}</> : <div className="loading-studio">正在打开工作流…</div>;
}
