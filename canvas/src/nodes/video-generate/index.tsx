/**
 * 视频生成节点（对接熙梦AI worker API，异步轮询）
 * data 驱动：参数与结果都存 form model，执行引擎可读写
 * 参数对齐主站：模型/比例/画质(按模型联动)/时长/数量
 */
import React from 'react';
import { FlowNodeRegistry, useNodeRender } from '@flowgram.ai/free-layout-editor';
import { getFormModel } from '@flowgram.ai/form-core';

const VIDEO_MODELS = [
  { value: 'doubao-seedance-2.5', label: '即梦 Seedance 2.5' },
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 Pro' },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  { value: 'doubao-seedance-2.0-mini', label: 'Seedance 2.0 Mini' },
];

const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

// 画质选项按模型联动（与主站一致）
const QUALITY_BY_MODEL: Record<string, string[]> = {
  'doubao-seedance-2.5': ['480P', '720P', '1080P'],
  'doubao-seedance-2-0-260128': ['720P', '1080P', '4k'], // 2.0 Pro
  'doubao-seedance-2-0-fast-260128': ['720P'], // 2.0 Fast
  'doubao-seedance-2.0-mini': ['720P'], // 2.0 Mini
};

export const VideoGenerateNodeRegistry: FlowNodeRegistry = {
  type: 'video-generate',
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
      const model = String(read('model', VIDEO_MODELS[0].value));
      const ratio = String(read('ratio', '16:9'));
      const quality = String(read('quality', '720P'));
      const duration = Number(read('duration', 5));
      const count = Number(read('count', 1));
      const status = String(read('status', 'idle'));
      const videoUrl = String(read('videoUrl', ''));

      // 画质选项按模型联动
      const qualityOptions = QUALITY_BY_MODEL[model] || ['480P', '720P', '1080P'];
      const curQuality = qualityOptions.includes(quality) ? quality : qualityOptions[0];

      return (
        <div style={{ minWidth: 340 }}>
          <div className="demo-free-node-title">🎬 视频生成</div>
          <div
            className="demo-free-node-content"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label style={{ fontSize: 12 }}>模型</label>
            <select
              value={model}
              onChange={(e) => {
                const m = e.target.value;
                const qOpts = QUALITY_BY_MODEL[m] || ['480P', '720P', '1080P'];
                update({ model: m, quality: qOpts[0] });
              }}
            >
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

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>比例</label>
                <select value={ratio} onChange={(e) => update({ ratio: e.target.value })}>
                  {RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>画质</label>
                <select
                  value={curQuality}
                  onChange={(e) => update({ quality: e.target.value })}
                >
                  {qualityOptions.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}>
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
              <div style={{ width: 70 }}>
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
