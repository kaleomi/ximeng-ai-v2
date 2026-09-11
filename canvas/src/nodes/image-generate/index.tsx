/**
 * 图片生成节点（对接熙梦AI worker API）
 * data 驱动：参数与结果都存 form model，执行引擎可读写
 * 参数对齐主站：模型/尺寸(按模型联动)/质量/数量/参考图
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

// gpt-image-2 官方尺寸（与主站一致）
const GPT_IMAGE_2_SIZES = [
  'auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048',
  '2048x1152', '1152x2048', '3840x2160', '2160x3840',
];
// 其他模型（豆包等）常用尺寸
const OTHER_SIZES = ['1024x1024', '1024x1792', '1792x1024', '2048x2048'];
const QUALITIES = ['auto', 'low', 'medium', 'high'];

// 尺寸按模型联动
const SIZES_BY_MODEL: Record<string, string[]> = {
  'gpt-image-2': GPT_IMAGE_2_SIZES,
  'gpt-image-2-all': GPT_IMAGE_2_SIZES,
};

export const ImageGenerateNodeRegistry: FlowNodeRegistry = {
  type: 'image-generate',
  meta: {
    defaultExpanded: true,
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
      const size = String(read('size', '1024x1024'));
      const quality = String(read('quality', 'auto'));
      const count = Number(read('count', 1));
      const image = String(read('image', ''));
      const status = String(read('status', 'idle'));
      const imageUrl = String(read('imageUrl', ''));

      // 尺寸按模型联动
      const sizeOptions = SIZES_BY_MODEL[model] || OTHER_SIZES;
      const curSize = sizeOptions.includes(size) ? size : sizeOptions[0];

      return (
        <div style={{ minWidth: 340 }}>
          <div className="demo-free-node-title">🖼 图片生成</div>
          <div
            className="demo-free-node-content"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label style={{ fontSize: 12 }}>模型</label>
            <select
              value={model}
              onChange={(e) => {
                const m = e.target.value;
                const opts = SIZES_BY_MODEL[m] || OTHER_SIZES;
                update({ model: m, size: opts[0] });
              }}
            >
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
                <select value={curSize} onChange={(e) => update({ size: e.target.value })}>
                  {sizeOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>质量</label>
                <select value={quality} onChange={(e) => update({ quality: e.target.value })}>
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: 64 }}>
                <label style={{ fontSize: 12 }}>数量</label>
                <select value={count} onChange={(e) => update({ count: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label style={{ fontSize: 12 }}>参考图 URL（图生图，可选）</label>
            <input
              type="text"
              value={image}
              onChange={(e) => update({ image: e.target.value })}
              placeholder="https://... 参考图链接"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />

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
