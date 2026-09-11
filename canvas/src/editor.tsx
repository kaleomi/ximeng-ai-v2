/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import { useState } from 'react';
import { EditorRenderer, FreeLayoutEditorProvider, useClientContext } from '@flowgram.ai/free-layout-editor';

import { useEditorProps } from './hooks/use-editor-props';
import { Tools } from './components/tools';
import { NodeAddPanel } from './components/node-add-panel';
import { Minimap } from './components/minimap';
import { executeWorkflow, resetWorkflowStatus } from './executor';
import { SAMPLE_WORKFLOW } from './sample-workflow';
import '@flowgram.ai/free-layout-editor/index.css';
import './index.css';

const ghostBtn: React.CSSProperties = {
  padding: '10px 14px',
  background: 'linear-gradient(160deg, rgba(40,46,78,0.9), rgba(28,32,58,0.95))',
  color: '#eef2ff',
  border: '1px solid rgba(140,150,220,0.25)',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
};

/** 运行控制条（运行 / 重置 / 示例 / 保存 / 加载 + 日志） */
function RunBar() {
  const { document } = useClientContext();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setLogs([]);
    await executeWorkflow(document, {
      onLog: (msg) => setLogs((prev) => [...prev.slice(-30), msg]),
      onFinished: () => setRunning(false),
    });
  };

  const handleReset = () => {
    resetWorkflowStatus(document);
    setLogs((p) => [...p.slice(-30), '♻️ 已重置所有节点状态']);
  };

  const handleSample = () => {
    document.fromJSON(SAMPLE_WORKFLOW as never);
    setLogs((p) => [...p.slice(-30), '✨ 已加载示例工作流（文本→图片→视频→结束）']);
  };

  const authToken = () => localStorage.getItem('ai_media_auth') || '';

  const handleSave = async () => {
    const token = authToken();
    if (!token) {
      setLogs((p) => [...p.slice(-30), '⚠️ 请先在主站登录（右上角），再回到画布保存']);
      return;
    }
    try {
      const json = document.toJSON();
      const res = await fetch('/api/workflow/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ json }),
      });
      const data = await res.json();
      if (data.ok) setLogs((p) => [...p.slice(-30), '💾 工作流已保存']);
      else setLogs((p) => [...p.slice(-30), `✗ 保存失败: ${data.error || ''}`]);
    } catch (e) {
      setLogs((p) => [...p.slice(-30), `✗ 保存异常: ${(e as Error).message}`]);
    }
  };

  const handleLoad = async () => {
    const token = authToken();
    if (!token) {
      setLogs((p) => [...p.slice(-30), '⚠️ 请先在主站登录（右上角），再回到画布加载']);
      return;
    }
    try {
      const res = await fetch('/api/workflow/load', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok && data.json) {
        document.fromJSON(data.json);
        setLogs((p) => [...p.slice(-30), '📂 工作流已加载']);
      } else if (data.ok && !data.json) {
        setLogs((p) => [...p.slice(-30), 'ℹ️ 暂无已保存的工作流']);
      } else {
        setLogs((p) => [...p.slice(-30), `✗ 加载失败: ${data.error || ''}`]);
      }
    } catch (e) {
      setLogs((p) => [...p.slice(-30), `✗ 加载异常: ${(e as Error).message}`]);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-end',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={handleSample} disabled={running} style={ghostBtn}>
          ✨ 示例
        </button>
        <button onClick={handleReset} disabled={running} style={ghostBtn}>
          ♻️ 重置
        </button>
        <button onClick={handleSave} disabled={running} style={ghostBtn}>
          💾 保存
        </button>
        <button onClick={handleLoad} disabled={running} style={ghostBtn}>
          📂 加载
        </button>
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            padding: '10px 24px',
            background: running ? '#999' : '#4d53e8',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: running ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 12px rgba(77,83,232,0.4)',
          }}
        >
          {running ? '⏳ 执行中...' : '▶ 运行工作流'}
        </button>
      </div>
      {logs.length > 0 && (
        <div
          style={{
            background: 'rgba(20,22,30,0.92)',
            color: '#c8d0e0',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12,
            fontFamily: 'monospace',
            maxWidth: 360,
            maxHeight: 200,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {logs.join('\n')}
        </div>
      )}
    </div>
  );
}


export const Editor = () => {
  const editorProps = useEditorProps();
  return (
    <FreeLayoutEditorProvider {...editorProps}>
      <div className="demo-free-container">
        <div className="demo-free-layout">
          <NodeAddPanel />
          <EditorRenderer className="demo-free-editor" />
        </div>
        <RunBar />
        <Tools />
        <Minimap />
      </div>
    </FreeLayoutEditorProvider>
  );
};
