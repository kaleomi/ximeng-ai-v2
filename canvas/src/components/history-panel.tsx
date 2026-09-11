import { useEffect, useState } from 'react';
import { useClientContext } from '@flowgram.ai/free-layout-editor';
import { HistoryEntry, readHistory, historyNodeData, safeHistoryUrl } from '../history';
import { notify } from '../api';
const labels: Record<string, string> = { all: '全部', image: '图片', video: '视频', audio: '音频', text: '文字' };
export function HistoryPanel({ running, onClose }: { running: boolean; onClose: () => void }) {
  const ctx = useClientContext();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const reload = () => { try { setEntries(readHistory()); setError(''); } catch { setError('无法读取本机历史记录'); } };
    reload(); window.addEventListener('storage', reload); window.addEventListener('canvas-history-change', reload);
    return () => { window.removeEventListener('storage', reload); window.removeEventListener('canvas-history-change', reload); };
  }, []);
  const add = (entry: HistoryEntry, src?: string) => {
    if (running) return;
    try { ctx.document.createWorkflowNodeByType('result', undefined, { data: historyNodeData(entry, src) }); notify('已添加历史结果，可从右侧输出端口继续连线'); }
    catch (e) { notify((e as Error).message); }
  };
  const visible = entries.filter(e => (filter === 'all' || e.type === filter) && ((e.model || '') + (e.prompt || '')).toLowerCase().includes(search.toLowerCase()));
  return <section className="history-panel" aria-label="生成历史记录" onPointerDown={e => e.stopPropagation()}>
    <header><strong>历史记录</strong><button aria-label="关闭历史记录" onClick={onClose}>×</button></header>
    <small>本机最近 50 条 · 与主站共享</small>
    <div className="history-filters"><select aria-label="历史类型" value={filter} onChange={e => setFilter(e.target.value)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input aria-label="搜索历史记录" placeholder="搜索模型或提示词" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="history-list">{error && <p role="alert">{error}</p>}{!error && !visible.length && <p>暂无记录。生成成功后会自动保存在这里。</p>}{visible.map((entry, index) => <article className="history-card" key={String(entry.ts) + index}>
      <div><strong>{entry.model || labels[entry.type]}</strong><small>{entry.ts ? new Date(entry.ts).toLocaleString() : labels[entry.type]}</small></div>
      {entry.type === 'image' ? (entry.images?.length ? entry.images : [entry.src]).filter(safeHistoryUrl).map((src, i) => <div key={src + i}><a href={src} target="_blank" rel="noreferrer"><img src={src} alt={'历史图片 ' + (i + 1)} loading="lazy" /></a><button disabled={running} onClick={() => add(entry, src)}>将这张图片放入画布 ↗</button></div>) : <>
        {entry.type === 'video' && safeHistoryUrl(entry.src) && <video src={entry.src} controls preload="metadata" />}
        {entry.type === 'audio' && safeHistoryUrl(entry.src) && <audio src={entry.src} controls preload="metadata" />}
        {entry.type === 'text' && <pre>{entry.src}</pre>}
        <button disabled={running} onClick={() => add(entry)}>放入画布 ↗</button>
      </>}
      {entry.prompt && <details><summary>提示词</summary><p>{entry.prompt}</p></details>}
    </article>)}</div>
  </section>;
}
