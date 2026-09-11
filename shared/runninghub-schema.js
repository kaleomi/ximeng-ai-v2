// Public metadata only. Never forward account credentials or execute documentation curl.
export async function fetchRunninghubSchema(appId, request = fetch) {
  if (typeof appId !== 'string' || !/^\d{1,25}$/.test(appId)) throw new Error('RunningHub 应用 ID 无效');
  const response = await request('https://www.runninghub.ai/api/webapp/detail', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webappId: appId }), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('无法读取 RunningHub 公开参数（' + response.status + '）');
  const result = await response.json();
  if (result.code !== 0 || !Array.isArray(result.data?.inputNodes)) throw new Error('应用未公开参数或不存在，请检查 ID 和应用访问权限');
  if (result.data.inputNodes.length > 100) throw new Error('应用参数过多，最多支持 100 个');
  return { appId, title: String(result.data.name || 'RunningHub 应用'),
    fields: result.data.inputNodes.map(n => ({ nodeId: String(n.nodeId), fieldName: String(n.fieldName),
      fieldType: String(n.fieldType), fieldValue: String(n.fieldValue ?? ''),
      fieldData: String(n.fieldData || ''), label: String(n.descriptionCn || n.description || n.fieldName) })) };
}

export function validateRunninghubSubmission(params) {
  if (typeof params.appId !== 'string' || !/^\d{1,25}$/.test(params.appId)) throw new Error('RunningHub 应用 ID 无效');
  if (!Array.isArray(params.nodeInfoList) || params.nodeInfoList.length > 100) throw new Error('RunningHub 节点参数无效');
  const seen = new Set();
  return params.nodeInfoList.map(n => {
    if (!n || typeof n.nodeId !== 'string' || !/^\d+$/.test(n.nodeId) || typeof n.fieldName !== 'string' || !n.fieldName || n.fieldName.length > 200 || !['string', 'number', 'boolean'].includes(typeof n.fieldValue)) throw new Error('RunningHub 字段格式无效');
    const key = n.nodeId + ':' + n.fieldName;
    if (seen.has(key)) throw new Error('RunningHub 字段重复');
    seen.add(key);
    return { nodeId: n.nodeId, fieldName: n.fieldName, fieldValue: String(n.fieldValue) };
  });
}
