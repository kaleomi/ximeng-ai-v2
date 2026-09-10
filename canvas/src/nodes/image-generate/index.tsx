/**
 * 图片生成节点（对接熙梦AI worker API）
 */
import React, { useState } from 'react';
import { FlowNodeRegistry, Field } from '@flowgram.ai/free-layout-editor';

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
      const [prompt, setPrompt] = useState('');
      const [model, setModel] = useState(IMAGE_MODELS[0].value);
      const [size, setSize] = useState(SIZES[0]);
      const [n, setN] = useState(1);
      const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
      const [imageUrl, setImageUrl] = useState('');

      const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setStatus('loading');
        setImageUrl('');
        try {
          const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...apiAuthHeaders(),
            },
            body: JSON.stringify({
              model,
              prompt,
              size,
              n,
            }),
          });
          const data = await res.json();
          if (data.ok && data.url) {
            setImageUrl(data.url);
            setStatus('done');
          } else {
            setStatus('error');
            alert(data.error || '生成失败');
          }
        } catch (e) {
          setStatus('error');
          alert('请求失败: ' + (e as Error).message);
        }
      };

      return (
        <div style={{ minWidth: 320 }}>
          <Field<string> name="title">
            {({ field }) => <div className="demo-free-node-title">🖼 图片生成</div>}
          </Field>
          <div className="demo-free-node-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12 }}>模型</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {IMAGE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 12 }}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="描述你想生成的图片..."
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>尺寸</label>
                <select value={size} onChange={(e) => setSize(e.target.value)}>
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: 70 }}>
                <label style={{ fontSize: 12 }}>数量</label>
                <select value={n} onChange={(e) => setN(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={status === 'loading' || !prompt.trim()}
              style={{
                padding: '8px 0',
                background: status === 'loading' ? '#ccc' : '#4d53e8',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {status === 'loading' ? '生成中...' : '✨ 生成图片'}
            </button>

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

function apiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = localStorage.getItem('ai_media_api_key');
  const baseUrl = localStorage.getItem('ai_media_base_url');
  if (apiKey) headers['x-api-key'] = apiKey;
  if (baseUrl) headers['x-base-url'] = baseUrl;
  return headers;
}
