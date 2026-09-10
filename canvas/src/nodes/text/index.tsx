/**
 * 文本节点：提供 prompt/文本输入，作为下游生成节点的数据源
 */
import React from 'react';
import { FlowNodeRegistry, useNodeRender } from '@flowgram.ai/free-layout-editor';
import { getFormModel } from '@flowgram.ai/form-core';

export const TextNodeRegistry: FlowNodeRegistry = {
  type: 'text',
  meta: {
    defaultPorts: [
      { type: 'input', position: 'left' },
      { type: 'output', position: 'right' },
    ],
  },
  formMeta: {
    render: () => {
      const { node } = useNodeRender();
      const form = getFormModel(node) as any;
      const read = (k: string, def: unknown = '') => {
        try {
          const v = form?.getValueIn(k);
          return v === undefined || v === null ? def : v;
        } catch {
          return def;
        }
      };
      const update = (patch: Record<string, unknown>) => {
        try {
          Object.entries(patch).forEach(([k, v]) => form?.setValueIn(k, v));
        } catch {
          // ignore
        }
      };

      const text = String(read('text', ''));
      const status = String(read('status', 'idle'));

      return (
        <div style={{ minWidth: 260 }}>
          <div className="demo-free-node-title">📝 文本</div>
          <div
            className="demo-free-node-content"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label style={{ fontSize: 12 }}>文本内容（可作为下游节点的 Prompt）</label>
            <textarea
              value={text}
              onChange={(e) => update({ text: e.target.value })}
              rows={4}
              placeholder="输入文本 / 提示词..."
            />
            {status === 'completed' && (
              <div style={{ fontSize: 11, color: '#34d399' }}>✓ 已就绪</div>
            )}
          </div>
        </div>
      );
    },
  },
};
