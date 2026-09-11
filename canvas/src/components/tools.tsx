import { useEffect, useState } from 'react';
import { usePlaygroundTools, useClientContext } from '@flowgram.ai/free-layout-editor';
export function Tools({ running = false }: { running?: boolean }) {
  const { history } = useClientContext();
  const tools = usePlaygroundTools();
  const [version, setVersion] = useState(0);
  useEffect(() => { const listener = history.undoRedoService.onChange(() => setVersion((n) => n + 1)); return () => listener.dispose(); }, [history]);
  return <div className="canvas-tools" role="toolbar" aria-label="画布工具">
    <button onClick={() => tools.zoomout()} aria-label="缩小" title="缩小">−</button><span className="zoom-value">{Math.round(tools.zoom * 100)}%</span><button onClick={() => tools.zoomin()} aria-label="放大" title="放大">+</button>
    <span className="tool-divider" /><button onClick={() => tools.fitView()} title="查看全部节点">适应</button><button onClick={() => tools.autoLayout({})} disabled={running}>整理</button><span className="tool-divider" />
    <button onClick={() => history.undo()} disabled={running || !history.canUndo()} title="撤销 Ctrl+Z">↶</button><button onClick={() => history.redo()} disabled={running || !history.canRedo()} title="重做 Ctrl+Shift+Z">↷</button>
  </div>;
}
