/**
 * 视频生成节点（对接熙梦AI worker API，异步轮询）
 * data 驱动：参数与结果都存 form model，执行引擎可读写
 */
import React from 'react';
import { FlowNodeRegistry, useNodeRender } from '@flowgram.ai/free-layout-editor';
import { getFormModel } from '@flowgram.ai/form-core';

const VIDEO_MODELS = [
  { value: 'doubao-seedance-2.5', label: 'Seedance 2.5' },
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 Pro' },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  { value: 'doubao-seedance-2.0-mini', label: 'Seedance 2.0 Mini' },
];

export const VideoGenerateNodeRegistry: FlowNodeRegistry = {
  type: 'video-generate',
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

      const prompt = String(read('prompt', ''));
      const model = String(read('model', VIDEO_MODELS[0].value));
      const duration = Number(read('duration', 5));
      const status = String(read('status', 'idle'));
      const videoUrl = String(read('videoUrl', ''));

      return (
        <div style={{ minWidth: 320 }}>
          <div className="demo-free-node-title">🎬 视频生成</div>
          <div
            className="demo-free-node-content"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label style={{ fontSize: 12 }}>模型</label>
            <select value={model} onChange={(e) => update({ model: e.target.value })}>
              {VIDEO_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 12 }}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => update({ prompt: e.target.value })}
              rows={3}
              placeholder="描述你想生成的视频..."
            />

            <div>
              <label style={{ fontSize: 12 }}>时长: {duration}s</label>
              <input
                type="range"
                min={5}
                max={15}
                value={duration}
                onChange={(e) => update({ duration: Number(e.target.value) })}
                style={{ width: '100%' }}
              />
            </div>

            {status === 'processing' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '8px 0',
                  color: '#8a7bff',
                  fontSize: 12,
                }}
              >
                ⏳ 视频生成中(约1-3分钟)...
              </div>
            )}

            {videoUrl && (
              <video
                src={videoUrl}
                controls
                style={{ width: '100%', borderRadius: 6, maxHeight: 240 }}
              />
            )}
          </div>
        </div>
      );
    },
  },
};
