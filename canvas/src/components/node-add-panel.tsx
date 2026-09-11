import { RunninghubImport } from './runninghub-fields';
import { useState } from 'react';
import { useClientContext } from '@flowgram.ai/free-layout-editor';
import { NODE_CATALOG, newNodeData } from '../workflow';
export function NodeAddPanel({ running = false }: { running?: boolean }) {
  const { document } = useClientContext();
  const [query, setQuery] = useState('');
  const items = NODE_CATALOG.filter((n) => (n.title + n.subtitle).includes(query.trim()));
  return <aside className="studio-sidebar">
    <div className="sidebar-heading">节点库 <small>点击 / 拖入</small></div>
    <input className="node-search" aria-label="搜索节点" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索节点…" />
    <div className="node-catalog">{['输入', '生成', '输出'].map((group) => <section key={group}>
      {items.some((n) => n.group === group) && <div className="catalog-group">{group}</div>}
      {items.filter((n) => n.group === group).map((n) => <button className="node-card" key={n.type} title={'添加' + n.title} disabled={running} draggable={!running} style={{ '--node-color': n.color } as React.CSSProperties} onDragStart={(e) => { e.dataTransfer.setData('application/ximeng-node', n.type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => document.createWorkflowNodeByType(n.type, undefined, { data: newNodeData(n.type) })}>
        <span className="catalog-icon">{n.icon}</span><span><strong>{n.title}</strong><small>{n.subtitle}</small></span><span className="card-plus">+</span>
      </button>)}</section>)}
      {!items.length && <p className="empty-search">没有匹配的节点</p>}
    </div>
    <RunninghubImport running={running} />
    <div className="sidebar-help"><p>从输出圆点拖到输入圆点连线</p><p>滚轮缩放 · 拖动空白处平移</p><p><kbd>Delete</kbd> 删除选中节点或连线</p><p><kbd>Ctrl + V</kbd> 粘贴图片</p><p>右键空白处添加节点</p></div>
    <div className="sidebar-bottom"><span>熙梦 AI</span><span>工作流画布</span></div>
  </aside>;
}
