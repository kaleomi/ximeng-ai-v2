import { useEffect, useRef, useState } from 'react';
import { useClientContext } from '@flowgram.ai/free-layout-editor';
import { apiRequest, notify } from '../api';
import { NodeData, portColor, portLabel } from '../workflow';
import { cleanRHSchema, parseAppId, rhDocUrl, rhFieldOptions, rhPort, rhType, rhValues } from '../runninghub';

export function RunninghubImport({ running }: { running: boolean }) {
  const ctx = useClientContext();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(running); locked.current = running;
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  let id = ''; try { id = parseAppId(value); } catch { /* incomplete input */ }
  const add = async () => {
    if (busy || locked.current) return;
    setError(''); setBusy(true);
    controller.current = new AbortController();
    try {
      const appId = parseAppId(value);
      const response = await apiRequest('/api/runninghub/schema/' + appId, { signal: controller.current.signal });
      const schema = cleanRHSchema(response.schema);
      if (locked.current) throw new Error('请停止运行后再次导入');
      ctx.document.createWorkflowNodeByType('runninghub', undefined, { data: { title: schema.title, rhSchema: schema, rhValues: rhValues({ rhSchema: schema }), status: 'idle' } });
      notify('已导入「' + schema.title + '」· ' + schema.fields.length + ' 个参数');
      void ctx.tools.fitView();
    } catch (e) { if (!controller.current?.signal.aborted) setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="rh-import"><strong>导入 RunningHub</strong><input aria-label="RunningHub 应用 ID 或链接" placeholder="应用 ID 或链接" value={value} disabled={busy} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} /><button disabled={running || busy || !value.trim()} onClick={() => void add()}>{busy ? '正在读取参数…' : '读取参数并添加节点'}</button>{id && <a href={rhDocUrl(id)} target="_blank" rel="noreferrer">查看对应 API 文档 ↗</a>}<small>自动识别输入类型、选项和默认值</small>{error && <div className="node-error" role="alert">{error}</div>}</section>;
}

export function RunninghubFields({ data, update }: { data: NodeData; update: (patch: Partial<NodeData>) => void }) {
  const values = rhValues(data);
  const active = useRef<AbortController>();
  const valuesRef = useRef(values); valuesRef.current = values;
  useEffect(() => () => active.current?.abort(), []);
  const set = (key: string, value: string) => { valuesRef.current = { ...valuesRef.current, [key]: value }; update({ rhValues: valuesRef.current }); };
  const upload = async (key: string, file?: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { update({ error: '文件不能超过 20 MB' }); return; }
    active.current?.abort(); active.current = new AbortController();
    update({ status: 'uploading', error: '' });
    try {
      const body = new FormData(); body.append('file', file);
      const result = await apiRequest('/api/rh-upload', { method: 'POST', body, signal: active.current.signal });
      if (!result.filename) throw new Error('上传未返回文件编号');
      set(key, result.filename); update({ status: 'idle', error: '' });
    } catch (e) { if (!active.current.signal.aborted) update({ status: 'error', error: (e as Error).message }); }
  };
  if (!data.rhSchema) return <div className="node-error">请通过左侧应用 ID 导入节点</div>;
  return <><a className="result-link" href={rhDocUrl(data.rhSchema.appId)} target="_blank" rel="noreferrer">API 文档 · {data.rhSchema.appId} ↗</a><small className="field-hint">连线输入优先于下方字段；未修改的参数沿用应用默认值。运行使用主站 API 设置中的 RunningHub Key。</small>{data.rhSchema.fields.map(f => {
    const key = rhPort(f), type = rhType(f), spec = rhFieldOptions(f), value = values[key];
    const media = type && ['image', 'video', 'audio'].includes(type);
    return <div className="rh-field" key={key}>
      <label className="field-label"><span>{type && <span className="rh-port" data-port-id={key} data-port-type="input" data-port-location="left" style={{ color: portColor[type] }} title={portLabel[type] + '输入'} />}{f.label} <small>#{f.nodeId} · {f.fieldName}{type ? ' · ' + portLabel[type] : ''}</small></span>
        {f.fieldType === 'LIST' && spec.options?.length ? <select value={value} onChange={e => set(key, e.target.value)}>{Array.from(new Set([value, ...spec.options])).map(v => <option key={v} value={v}>{v}</option>)}</select>
          : f.fieldType === 'BOOLEAN' ? <select value={value} onChange={e => set(key, e.target.value)}><option value="true">是</option><option value="false">否</option></select>
          : type === 'text' ? <textarea rows={3} value={value} onChange={e => set(key, e.target.value)} />
          : <input type={['INT', 'FLOAT'].includes(f.fieldType) ? 'number' : 'text'} min={spec.min} max={spec.max} step={f.fieldType === 'INT' ? 1 : spec.step || 'any'} value={value} placeholder={media ? '文件地址、文件编号或连接左侧入口' : '参数值'} onChange={e => set(key, e.target.value)} />}
      </label>
      {media && <label className="rh-upload">上传{portLabel[type]}<input aria-label={'上传 ' + f.label + ' #' + f.nodeId} type="file" disabled={data.status === 'uploading'} accept={type + '/*'} onChange={e => { void upload(key, e.target.files?.[0]); e.target.value = ''; }} /></label>}
    </div>;
  })}</>;
}
