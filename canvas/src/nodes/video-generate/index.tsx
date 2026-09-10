/**
 * 视频生成节点（对接熙梦AI worker API，异步轮询）
 */
import React, { useState } from 'react';
import { FlowNodeRegistry, Field } from '@flowgram.ai/free-layout-editor';

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
      const [prompt, setPrompt] = useState('');
      const [model, setModel] = useState(VIDEO_MODELS[0].value);
      const [duration, setDuration] = useState(5);
      const [status, setStatus] = useState<'idle' | 'loading' | 'polling' | 'done' | 'error'>(
        'idle'
      );
      const [videoUrl, setVideoUrl] = useState('');

      const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setStatus('loading');
        setVideoUrl('');
        try {
          const res = await fetch('/api/generate-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...apiAuthHeaders(),
            },
            body: JSON.stringify({
              model,
              prompt,
              duration,
              flavor: 'ark',
            }),
          });
          const data = await res.json();
          if (!data.ok || !data.taskId) {
            setStatus('error');
            alert(data.error || '提交失败');
            return;
          }
          setStatus('polling');
          await pollVideo(data.taskId);
        } catch (e) {
          setStatus('error');
          alert('请求失败: ' + (e as Error).message);
        }
      };

      const pollVideo = async (taskId: string) => {
        let attempts = 0;
        const maxAttempts = 120;
        while (attempts < maxAttempts) {
          await sleep(3000);
          attempts++;
          try {
            const res = await fetch(`/api/video-status/${taskId}`, {
              headers: { ...apiAuthHeaders() },
            });
            const data = await res.json();
            if (data.ok && data.status === 'succeeded') {
              setVideoUrl(data.url);
              setStatus('done');
              return;
            }
            if (data.status === 'failed' || data.status === 'error') {
              setStatus('error');
              alert('视频生成失败');
              return;
            }
          } catch (e) {
            // 继续轮询
          }
        }
        setStatus('error');
        alert('视频生成超时');
      };

      return (
        <div style={{ minWidth: 320 }}>
          <Field<string> name="title">
            {({ field }) => <div className="demo-free-node-title">🎬 视频生成</div>}
          </Field>
          <div
            className="demo-free-node-content"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label style={{ fontSize: 12 }}>模型</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {VIDEO_MODELS.map((m) => (
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
              placeholder="描述你想生成的视频..."
            />

            <div>
              <label style={{ fontSize: 12 }}>时长: {duration}s</label>
              <input
                type="range"
                min={5}
                max={15}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={status === 'loading' || status === 'polling' || !prompt.trim()}
              style={{
                padding: '8px 0',
                background: status === 'loading' || status === 'polling' ? '#ccc' : '#4d53e8',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {status === 'loading'
                ? '提交中...'
                : status === 'polling'
                  ? '生成中(约1-3分钟)...'
                  : '🎬 生成视频'}
            </button>

            {status === 'polling' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '12px 0',
                  color: '#888',
                  fontSize: 12,
                }}
              >
                视频生成中，请耐心等待...
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = localStorage.getItem('ai_media_api_key');
  const baseUrl = localStorage.getItem('ai_media_base_url');
  if (apiKey) headers['x-api-key'] = apiKey;
  if (baseUrl) headers['x-base-url'] = baseUrl;
  return headers;
}
