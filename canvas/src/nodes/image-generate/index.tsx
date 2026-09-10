/**
 * 图片生成节点（对接熙梦AI worker API）
 * data 驱动：参数与结果都存 form model，执行引擎可读写
 */
import React from 'react';
import { FlowNodeRegistry, useNodeRender } from '@flowgram.ai/free-layout-editor';
import { getFormModel } from '@flowgram.ai/form-core';

const IMAGE_MODELS = [
  { value: 'doubao-seedream-5-0-260128', label: '即梦3 Seedream 5.0' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-all', label: 'GPT Image 2 逆向' },
  { value: 'gemini-3.1-flash-lite-image', label: 'Gemini Flash Lite' },
];

const SIZES = ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '3840x2160'];

export const ImageGenerateNodeRegistry: FlowNodeRegistry = {
  type: 'image-generate',
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
      const model = String(read('model', IMAGE_MODELS[0].value));
      const size = String(read('size', SIZES[0]));
      const n = Number(read('n', 1));
      const status = String(read('status', 'idle'));
      const imageUrl = String(read('imageUrl', ''));

      return (
        <div style={{ minWidth: 320 }}>
          <div className="demo-free-node-title">🖼 图片生成</div>
          <div
            className="demo-free-node-content"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label style={{ fontSize: 12 }}>模型</label>
            <select value={model} onChange={(e) => update({ model: e.target.value })}>
              {IMAGE_MODELS.map((m) => (
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
              placeholder="描述你想生成的图片..."
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>尺寸</label>
                <select value={size} onChange={(e) => update({ size: e.target.value })}>
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: 70 }}>
                <label style={{ fontSize: 12 }}>数量</label>
                <select value={n} onChange={(e) => update({ n: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
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
                ⏳ 生成中...
              </div>
            )}

            {imageUrl && (
              <img
                src={imageUrl}
                alt="generated"
                style={{ width: '100%', borderRadius: 6, maxHeight: 240, objectFit: 'contain' }}
              />
            )}
          </div>
        </div>
      );
    },
  },
};
