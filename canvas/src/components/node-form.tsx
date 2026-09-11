import { RunninghubFields } from './runninghub-fields';
import { useEffect, useRef, useState } from 'react';
import { useNodeRender, useInitializedFormModel, useWatchFormValues } from '@flowgram.ai/free-layout-editor';
import { getDefinition, NodeData, portLabel, portColor } from '../workflow';
import { IMAGE_ACCEPT, uploadImage, validateImage, takeImage } from '../api';
const IMAGE_MODELS = ['doubao-seedream-5-0-260128', 'gpt-image-2', 'gpt-image-2-all', 'gemini-3.1-flash-lite-image'];
const VIDEO_MODELS = ['doubao-seedance-2.5', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2.0-mini'];
const MODEL_LABELS = ['Seedream 5.0', 'GPT Image 2', 'GPT Image 2 逆向', 'Gemini Flash Lite'];
const VIDEO_LABELS = ['Seedance 2.5', 'Seedance 2.0 Pro', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'];
export const imageSizes = (model?: string) => model?.startsWith('gpt-image-2') ? ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840'] : ['1024x1024', '1024x1792', '1792x1024', '2048x2048'];
export const videoQualities = (model?: string) => model === VIDEO_MODELS[1] ? ['720P', '1080P', '4k'] : model === VIDEO_MODELS[2] || model === VIDEO_MODELS[3] ? ['720P'] : ['480P', '720P', '1080P'];
const STATUS = { idle: '未运行', uploading: '上传中', processing: '运行中', completed: '已完成', error: '失败', skipped: '已跳过' };
function SelectField({ label, value, options, labels, onChange }: { label: string; value: string | number; options: (string | number)[]; labels?: string[]; onChange: (value: string) => void }) {
  return <label className="field-label">{label}<select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option, i) => <option key={option} value={option}>{labels?.[i] || option}</option>)}</select></label>;
}
export function ImageInput({ data, update, nodeId, disabled }: { data: NodeData; update: (patch: Partial<NodeData>) => void; nodeId: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController>();
  const localUrl = useRef('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { controller.current?.abort(); if (localUrl.current) URL.revokeObjectURL(localUrl.current); }, []);
  const accept = async (file?: File) => {
    if (!file || disabled) return;
    try { validateImage(file); } catch (e) { update({ error: (e as Error).message }); return; }
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = URL.createObjectURL(file);
    update({ preview: localUrl.current, imageUrl: '', image: '', output: '', filename: file.name, status: 'uploading', error: '' });
    setBusy(true);
    try {
      const url = await uploadImage(file, active.signal);
      if (!active.signal.aborted) update({ imageUrl: url, image: url, preview: '', status: 'idle', error: '' });
    } catch (e) { if (!active.signal.aborted) update({ status: 'error', error: (e as Error).message }); }
    finally { if (!active.signal.aborted) setBusy(false); }
  };
  useEffect(() => {
    const file = takeImage(nodeId);
    if (file) void accept(file);
    else if (data.status === 'uploading' || data.preview?.startsWith('blob:')) update({ preview: '', status: 'error', error: '上传已中断，请重新选择图片' });
  }, [nodeId]);
  return <div className="image-input">
    <button type="button" className={'upload-zone ' + (dragging ? 'drag-over' : '')} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); void accept(e.dataTransfer.files[0]); }}>
      {data.preview || data.imageUrl ? <img src={data.preview || data.imageUrl} alt={data.filename || '上传的参考图'} draggable={false} /> : <><span className="upload-symbol">↑</span><strong>点击上传，或拖入图片</strong><small>PNG / JPG / WebP · 最大 20 MB</small></>}
      {(data.preview || data.imageUrl) && <span className="replace-image">{busy || data.status === 'uploading' ? '正在上传…' : '更换图片'}</span>}
    </button>
    <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => { void accept(e.target.files?.[0]); e.target.value = ''; }} />
    {data.filename && <div className="file-caption" title={data.filename}>{data.filename}</div>}
    {!data.imageUrl && !data.preview && <label className="field-label">或使用图片链接<input type="url" value={data.image || ''} placeholder="https://…" onChange={(e) => update({ image: e.target.value, status: 'idle', error: '' })} /></label>}
  </div>;
}
export function NodeForm() {
  const { node, deleteNode, readonly } = useNodeRender();
  const form = useInitializedFormModel(node);
  const data = useWatchFormValues<NodeData>(node) || {};
  const type = String(node.flowNodeType);
  const definition = getDefinition(type);
  const update = (patch: Partial<NodeData>) => Object.entries(patch).forEach(([key, value]) => form.setValueIn(key, value));
  const generation = type === 'image-generate' || type === 'video-generate';
  const rh = type === 'runninghub';
  const relay = type === 'preview' || type === 'result';
  const video = type === 'video-generate';
  const inputs = definition?.inputs || [];
  const outputs = data.images?.length ? data.images : data.imageUrl ? [data.imageUrl] : [];
  return <div className={'node-body node-' + type} style={{ '--node-color': definition?.color || '#89909e' } as React.CSSProperties}>
    <header className="node-header"><span className="node-icon">{definition?.icon || '◇'}</span><strong>{data.title || definition?.title || (type === 'start' ? '开始' : '结束')}</strong><span className="node-id">{node.id.slice(-4)}</span><button disabled={readonly} aria-label="删除节点" title="删除节点" onClick={(e) => { e.stopPropagation(); deleteNode(); }}>×</button></header>
    <div className="node-ports" style={{ minHeight: Math.max(rh || relay ? 4 : 1, inputs.length) * 30 + 12 }}>
      {(rh || relay) && (['image', 'video', 'audio', 'text'] as const).map((port, i) => <span key={port} className="port-label output-label" style={{ top: i * 30 + 6, color: portColor[port] }}>{portLabel[port]}输出<span className="rh-output-port" title={portLabel[port] + '输出：拖到下个节点入口'} data-port-id={port} data-port-type="output" data-port-location="right" /></span>)}
      {inputs.map((port, i) => <span className="port-label input-label" key={port} style={{ top: i * 30 + 6, color: portColor[port] }}>{portLabel[port]}</span>)}
      {definition?.output && <span className="port-label output-label" title="拖动右侧圆点，连接到下一个节点的输入圆点" style={{ color: portColor[definition.output] }}>{portLabel[definition.output]}输出 ↗</span>}
    </div>
    <div className="node-content" onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <fieldset disabled={readonly || data.status === 'processing' || data.status === 'uploading'}>
      {rh && <RunninghubFields data={data} update={update} />}
      {type === 'text' && <><label className="field-label">文字描述<textarea rows={6} value={data.text || ''} onChange={(e) => update({ text: e.target.value })} placeholder="描述画面、风格、光线与细节…" /></label><small className="field-hint">连接右侧「提示词」到生成节点</small></>}
      {type === 'image-upload' && <ImageInput nodeId={node.id} data={data} update={update} disabled={readonly} />}
      {generation && <>
        <SelectField label="模型" value={data.model || ''} options={video ? VIDEO_MODELS : IMAGE_MODELS} labels={video ? VIDEO_LABELS : MODEL_LABELS} onChange={(model) => update(video ? { model, quality: videoQualities(model)[0] } : { model, size: imageSizes(model)[0] })} />
        <label className="field-label">提示词<textarea rows={3} value={data.prompt || ''} placeholder="连接提示词节点，或在这里输入…" onChange={(e) => update({ prompt: e.target.value })} /></label>
        <div className="field-row"><SelectField label={video ? '画面比例' : '图片尺寸'} value={(video ? data.ratio : data.size) || ''} options={video ? ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] : imageSizes(data.model)} onChange={(value) => update(video ? { ratio: value } : { size: value })} /><SelectField label="质量" value={data.quality || 'auto'} options={video ? videoQualities(data.model) : ['auto', 'low', 'medium', 'high']} onChange={(quality) => update({ quality })} /></div>
        <div className="field-row">{video && <SelectField label="时长（秒）" value={data.duration || 5} options={[5, 6, 7, 8, 9, 10, 12, 15]} onChange={(duration) => update({ duration: Number(duration) })} />}<SelectField label="生成数量" value={data.count || 1} options={[1, 2, 3, 4]} onChange={(count) => update({ count: Number(count) })} /></div>
        <small className="field-hint">参考图接入左侧「图片」端口</small>
        <details><summary>手动填写参考图链接</summary><input aria-label="参考图链接" type="url" value={data.image || ''} placeholder="https://…" onChange={(e) => update({ image: e.target.value })} /></details>
      </>}
      </fieldset>
      {definition && <button type="button" className="node-run-button" disabled={readonly || data.status === 'uploading'} onClick={() => window.dispatchEvent(new CustomEvent('canvas-run-node', { detail: node.id }))} title="只运行当前节点，使用上游已有结果，不重跑其他节点">{data.status === 'processing' ? '运行中…' : '▶ 单独运行'}</button>}
      {(generation || rh || relay) && <>
        {data.audioUrl && <audio src={data.audioUrl} controls />}
        {(rh || relay) && data.text && <pre className="rh-text-result">{data.text}</pre>}
        {data.videoUrl && <video src={data.videoUrl} controls preload="metadata" />}
        {outputs.map((url, i) => <div className="result-item" key={url + i}><a className="result-image" href={url} target="_blank" rel="noreferrer" title="打开原图"><img src={url} alt={'生成结果 ' + (i + 1)} draggable={false} /></a>{(generation || rh || relay) && outputs.length > 1 && <button type="button" className={'select-output ' + ((data.imageUrl || outputs[0]) === url ? 'is-output' : '')} disabled={readonly} aria-pressed={(data.imageUrl || outputs[0]) === url} onClick={() => update({ imageUrl: url, output: url })}>{(data.imageUrl || outputs[0]) === url ? '✓ 当前输出图片' : '设为输出图片'}</button>}</div>)}
        {relay && !data.videoUrl && !data.audioUrl && !data.text && !outputs.length && <div className="preview-empty"><span>▧</span><strong>结果会出现在这里</strong><small>连接上游结果后，点击单独运行</small></div>}
        {(data.videoUrl || outputs.length > 0) && <a className="result-link" href={data.videoUrl || data.imageUrl || outputs[0]} target="_blank" rel="noreferrer">打开原始文件 ↗</a>}
        {(generation || relay || rh) && (data.videoUrl || outputs.length > 0) && <small className="field-hint output-hint">结果已保留。将右侧输出圆点连到下个节点的入口，再在下个节点点击「单独运行」。</small>}
      </>}
      {data.error && <div className="node-error" role="alert">{data.error}</div>}
    </div>
    <footer className={'node-status ' + (data.status || 'idle')}><span className="status-indicator" />{STATUS[data.status || 'idle']}</footer>
  </div>;
}
