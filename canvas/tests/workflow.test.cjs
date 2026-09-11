const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Compile the actual TypeScript modules using the project's compiler; no test framework dependency.
require.extensions['.ts'] = (mod, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  mod._compile(result.outputText, filename);
};
const { normalizeWorkflow, connectionError, topologicalOrder, newNodeData } = require('../src/workflow.ts');
const { executeGraph } = require('../src/runner.ts');
const { apiRequest, apiAuthHeaders, uploadImage, validateImage } = require('../src/api.ts');
const { portableWorkflow } = require('../src/storage.ts');
const { initialData } = require('../src/initial-data.ts');
const node = (id, type, data = {}) => ({ id, type, data: { ...newNodeData(type), ...data }, meta: { position: { x: 0, y: 0 } } });
const edge = (sourceNodeID, sourcePortID, targetNodeID, targetPortID) => ({ sourceNodeID, sourcePortID, targetNodeID, targetPortID });
function harness() {
  const states = {}, logs = [], results = [], finished = [];
  return { states, logs, results, finished, callbacks: {
    update: (id, patch) => { states[id] = { ...states[id], ...patch }; },
    onLog: (message) => logs.push(message), onResult: (r) => results.push(r), onFinished: (ok) => finished.push(ok),
  } };
}
test('typed connections reject cycles, mismatches, self-links and occupied inputs', () => {
  const graph = { nodes: [node('a', 'image-generate'), node('b', 'image-generate')], edges: [edge('a', 'image', 'b', 'image')] };
  assert.match(connectionError(graph, 'b', 'a', 'image', 'image'), /循环/);
  assert.match(connectionError(graph, 'a', 'b', 'image', 'text'), /相同类型/);
  assert.match(connectionError(graph, 'a', 'a', 'image', 'image'), /自身/);
  assert.match(connectionError(graph, 'a', 'b', 'image', 'image'), /已连接/);
  assert.equal(connectionError({ ...graph, edges: [] }, 'a', 'b', 'image', 'image'), undefined);
});
test('legacy canvas IDs and unnamed ports migrate without losing prompt or references', () => {
  const graph = normalizeWorkflow({ nodes: [node('start', 'start'), node('t', 'text', { text: 'prompt' }), node('i', 'imagegenerate'), node('v', 'videogenerate')], edges: [
    { sourceNodeID: 'start', targetNodeID: 't' }, { sourceNodeID: 't', targetNodeID: 'i' }, { sourceNodeID: 'i', targetNodeID: 'v' },
  ] });
  assert.equal(graph.nodes[2].type, 'image-generate');
  assert.equal(graph.edges[1].sourcePortID, 'text');
  assert.equal(graph.edges[1].targetPortID, 'text');
  assert.equal(graph.edges[2].targetPortID, 'image');
  assert.deepEqual(topologicalOrder(graph.nodes, graph.edges), ['start', 't', 'i', 'v']);
});
test('imports reject dangling edges, duplicate IDs, invalid data and unsafe media links', () => {
  assert.throws(() => normalizeWorkflow({ nodes: [node('a', 'text'), node('a', 'text')], edges: [] }), /重复/);
  assert.throws(() => normalizeWorkflow({ nodes: [node('a', 'text')], edges: [edge('a', 'text', 'missing', 'text')] }), /不存在/);
  assert.throws(() => normalizeWorkflow({ nodes: [node('a', 'preview', { images: 'bad' })], edges: [] }), /数组/);
  assert.throws(() => normalizeWorkflow({ nodes: [node('a', 'preview', { imageUrl: 'javascript:alert(1)' })], edges: [] }), /链接/);
  assert.doesNotThrow(() => normalizeWorkflow(initialData));
});
test('text + uploaded reference feed correct image API params and preview all images', async () => {
  const graph = { nodes: [node('t', 'text', { text: 'connected prompt' }), node('u', 'image-upload', { imageUrl: 'https://example.com/input.png' }), node('i', 'image-generate', { model: 'gpt-image-2', count: 2, prompt: 'inline prompt' }), node('p', 'preview')], edges: [
    edge('t', 'text', 'i', 'text'), edge('u', 'image', 'i', 'image'), edge('i', 'image', 'p', 'media'),
  ] };
  const h = harness(), requests = [];
  const ok = await executeGraph(graph, h.callbacks, { request: async (path, init) => { requests.push({ path, body: JSON.parse(init.body) }); return { ok: true, images: ['https://example.com/1.png', 'https://example.com/2.png'] }; } });
  assert.equal(ok, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { path: '/api/generate-image', body: { prompt: 'connected prompt', params: { model: 'gpt-image-2', size: '1024x1024', quality: 'auto', n: 2, image: 'https://example.com/input.png' } } });
  assert.equal(h.states.p.status, 'completed');
  assert.equal(h.states.p.images.length, 2);
  assert.equal(h.results.length, 1);
  assert.deepEqual(h.finished, [true]);
});
test('uploaded image previews without a generation request', async () => {
  const h = harness();
  const graph = { nodes: [node('u', 'image-upload', { image: 'https://example.com/ref.webp' }), node('p', 'preview')], edges: [edge('u', 'image', 'p', 'media')] };
  assert.equal(await executeGraph(graph, h.callbacks, { request: () => { throw new Error('No generation should run'); } }), true);
  assert.equal(h.states.p.imageUrl, 'https://example.com/ref.webp');
});
test('preflight prevents generation when a required input is empty or uploading', async () => {
  for (const graph of [
    { nodes: [node('t', 'text'), node('i', 'image-generate')], edges: [edge('t', 'text', 'i', 'text')] },
    { nodes: [node('u', 'image-upload', { status: 'uploading' }), node('i', 'image-generate', { prompt: 'test' })], edges: [edge('u', 'image', 'i', 'image')] },
  ]) {
    const h = harness(); let requests = 0;
    assert.equal(await executeGraph(graph, h.callbacks, { request: async () => { requests++; } }), false);
    assert.equal(requests, 0);
    assert.deepEqual(h.finished, [false]);
  }
});
test('failed upstream skips descendants and clears stale result previews', async () => {
  const h = harness(); let requests = 0;
  const graph = { nodes: [node('i', 'image-generate', { prompt: 'test' }), node('v', 'video-generate', { prompt: 'animate' }), node('p', 'preview', { imageUrl: 'https://example.com/stale.png' })], edges: [edge('i', 'image', 'v', 'image'), edge('v', 'video', 'p', 'media')] };
  const ok = await executeGraph(graph, h.callbacks, { request: async () => { requests++; throw new Error('额度不足'); } });
  assert.equal(ok, false); assert.equal(requests, 1);
  assert.equal(h.states.i.error, '额度不足'); assert.equal(h.states.v.status, 'skipped');
  assert.equal(h.states.p.imageUrl, ''); assert.equal(h.states.p.status, 'skipped');
});
test('video handles immediate response as well as encoded task polling', async () => {
  for (const immediate of [true, false]) {
    const h = harness(), requests = [];
    const graph = { nodes: [node('v', 'video-generate', { prompt: 'animate', image: 'https://example.com/ref.png' })], edges: [] };
    const ok = await executeGraph(graph, h.callbacks, { pollInterval: 0, request: async (path, init) => {
      requests.push({ path, init });
      if (immediate || requests.length === 2) return { ok: true, status: 'succeeded', url: 'https://example.com/video.mp4' };
      return { ok: true, status: 'running', taskId: 'task/a b', flavor: 'ark' };
    } });
    assert.equal(ok, true); assert.equal(h.states.v.videoUrl, 'https://example.com/video.mp4');
    assert.equal(JSON.parse(requests[0].init.body).params.refImage, 'https://example.com/ref.png');
    if (!immediate) assert.equal(requests[1].path, '/api/video-status/task%2Fa%20b?flavor=ark');
  }
});
test('base64 images and polling timeout are explicit outcomes', async () => {
  const h = harness();
  assert.equal(await executeGraph({ nodes: [node('i', 'image-generate', { prompt: 'test' })], edges: [] }, h.callbacks, { request: async () => ({ ok: true, b64: 'aGVsbG8=' }) }), true);
  assert.equal(h.states.i.imageUrl, 'data:image/png;base64,aGVsbG8=');
  const v = harness();
  assert.equal(await executeGraph({ nodes: [node('v', 'video-generate', { prompt: 'test' })], edges: [] }, v.callbacks, { pollInterval: 0, pollAttempts: 1, request: async () => ({ ok: true, status: 'running', taskId: '123' }) }), false);
  assert.match(v.states.v.error, /超时/);
});
test('abort stops later generation and always releases the run state', async () => {
  const h = harness(), controller = new AbortController(); let requests = 0;
  const graph = { nodes: [node('i', 'image-generate', { prompt: 'test' }), node('v', 'video-generate', { prompt: 'animate' })], edges: [edge('i', 'image', 'v', 'image')] };
  assert.equal(await executeGraph(graph, h.callbacks, { signal: controller.signal, request: async () => { requests++; controller.abort(); throw new DOMException('aborted', 'AbortError'); } }), false);
  assert.equal(requests, 1); assert.deepEqual(h.finished, [false]); assert.match(h.logs.at(-1), /已停止/);
});
test('portable workflow removes transient blob preview and keeps remote image inputs', () => {
  const raw = { nodes: [node('u', 'image-upload', { imageUrl: 'https://example.com/input.png', preview: 'blob:temp', status: 'uploading' })], edges: [] };
  const saved = portableWorkflow(raw);
  assert.equal(saved.nodes[0].data.preview, undefined);
  assert.equal(saved.nodes[0].data.status, 'idle');
  assert.equal(saved.nodes[0].data.imageUrl, 'https://example.com/input.png');
  assert.equal(raw.nodes[0].data.preview, 'blob:temp');
});
test('API shares main-site settings and auth; upload sends multipart and exposes errors', async () => {
  const originalFetch = global.fetch, originalStorage = global.localStorage;
  global.localStorage = { getItem: (key) => ({ ai_media_api_settings: JSON.stringify({ apiKey: 'test-key', baseUrl: 'https://example.com', rhKey: 'rh-test' }), ai_media_auth: 'test-token' })[key] || null };
  try {
    assert.deepEqual(apiAuthHeaders(), { 'x-api-key': 'test-key', 'x-base-url': 'https://example.com', 'x-rh-key': 'rh-test', Authorization: 'Bearer test-token' });
    global.fetch = async (path, init) => {
      assert.equal(path, '/api/upload'); assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get('file').name, 'test.png'); assert.equal(init.headers.Authorization, 'Bearer test-token');
      assert.equal(init.headers['Content-Type'], undefined);
      return new Response(JSON.stringify({ ok: true, url: 'https://example.com/upload.png' }), { status: 200 });
    };
    assert.equal(await uploadImage(new File(['test'], 'test.png', { type: 'image/png' })), 'https://example.com/upload.png');
    global.fetch = async () => new Response(JSON.stringify({ ok: false, error: '上传失败' }), { status: 400 });
    await assert.rejects(() => apiRequest('/api/upload'), /上传失败/);
    assert.throws(() => validateImage(new File(['text'], 'test.txt', { type: 'text/plain' })), /支持/);
    assert.throws(() => validateImage(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })), /20 MB/);
  } finally { global.fetch = originalFetch; global.localStorage = originalStorage; }
});


test('legacy image-to-video workflows inherit the text prompt through image output', async () => {
  const graph = normalizeWorkflow({ nodes: [node('t', 'text', { text: 'legacy prompt' }), node('i', 'image-generate'), node('v', 'video-generate')], edges: [{ sourceNodeID: 't', targetNodeID: 'i' }, { sourceNodeID: 'i', targetNodeID: 'v' }] });
  const h = harness(), bodies = [];
  assert.equal(await executeGraph(graph, h.callbacks, { request: async (path, init) => {
    bodies.push(JSON.parse(init.body));
    return path.endsWith('image') ? { ok: true, url: 'https://example.com/image.png' } : { ok: true, status: 'succeeded', url: 'https://example.com/video.mp4' };
  } }), true);
  assert.equal(bodies[1].prompt, 'legacy prompt');
  assert.equal(bodies[1].params.refImage, 'https://example.com/image.png');
});

test('single-node run ignores unrelated incomplete nodes and never runs descendants', async () => {
  const graph = { nodes: [node('a', 'image-generate', { prompt: 'original' }), node('b', 'image-generate'), node('unfinished', 'image-upload', { status: 'uploading' })], edges: [edge('a', 'image', 'b', 'image')] };
  const h = harness(), calls = [];
  assert.equal(await executeGraph(graph, h.callbacks, { nodeId: 'a', request: async (path, init) => { calls.push(JSON.parse(init.body)); return { url: 'https://example.com/a.png' }; } }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(h.states), ['a']);
  assert.equal(h.states.a.imageUrl, 'https://example.com/a.png');
});

test('generate first, then connect existing selected output to another image generation node', async () => {
  const graph = { nodes: [node('a', 'image-generate', { prompt: 'original' }), node('b', 'image-generate', { prompt: 'change the background' })], edges: [] };
  const update = (id, patch) => { const target = graph.nodes.find((n) => n.id === id); Object.assign(target.data, patch); };
  const requests = [];
  const request = async (path, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1 ? { images: ['https://example.com/a1.png', 'https://example.com/a2.png'] } : { url: 'https://example.com/edited.png' };
  };
  assert.equal(await executeGraph(structuredClone(graph), { update }, { nodeId: 'a', request }), true);
  graph.nodes[0].data.imageUrl = graph.nodes[0].data.images[1];
  graph.nodes[0].data.output = graph.nodes[0].data.images[1];
  graph.edges.push(edge('a', 'image', 'b', 'image'));
  const savedA = structuredClone(graph.nodes[0]);
  assert.equal(await executeGraph(structuredClone(graph), { update }, { nodeId: 'b', request }), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].prompt, 'change the background');
  assert.equal(requests[1].params.image, 'https://example.com/a2.png');
  assert.deepEqual(graph.nodes[0], savedA);
  assert.equal(graph.nodes[1].data.imageUrl, 'https://example.com/edited.png');
});

test('single-node image generation reads current text input without running the text node', async () => {
  const graph = { nodes: [node('t', 'text', { text: 'latest text', output: 'old text' }), node('i', 'image-generate')], edges: [edge('t', 'text', 'i', 'text')] };
  const h = harness();
  assert.equal(await executeGraph(graph, h.callbacks, { nodeId: 'i', request: async (_path, init) => { assert.equal(JSON.parse(init.body).prompt, 'latest text'); return { url: 'https://example.com/result.png' }; } }), true);
  assert.equal(h.states.t, undefined);
});

test('single-node generation refuses unavailable connected outputs instead of silently using a reference input', async () => {
  for (const sourceData of [{ prompt: 'not run', image: 'https://example.com/input-not-output.png' }, { imageUrl: 'https://example.com/old.png', status: 'processing' }]) {
    const graph = { nodes: [node('a', 'image-generate', sourceData), node('b', 'image-generate', { prompt: 'edit', image: 'https://example.com/fallback.png' })], edges: [edge('a', 'image', 'b', 'image')] };
    const h = harness(); let calls = 0;
    assert.equal(await executeGraph(graph, h.callbacks, { nodeId: 'b', request: async () => { calls++; } }), false);
    assert.equal(calls, 0);
    assert.equal(h.states.b.status, 'error');
    assert.equal(h.states.a, undefined);
  }
});

test('saved results can feed single-node video or preview after reopening the workflow', async () => {
  const raw = { nodes: [node('a', 'image-generate', { imageUrl: 'https://example.com/saved.png', prompt: 'original', status: 'completed' }), node('v', 'video-generate', { prompt: 'animate' }), node('p', 'preview')], edges: [edge('a', 'image', 'v', 'image'), edge('a', 'image', 'p', 'media')] };
  const graph = normalizeWorkflow(portableWorkflow(raw));
  const h = harness(); let requests = 0;
  assert.equal(await executeGraph(graph, h.callbacks, { nodeId: 'v', request: async (path, init) => {
    requests++; assert.equal(path, '/api/generate-video'); assert.equal(JSON.parse(init.body).params.refImage, 'https://example.com/saved.png');
    return { status: 'succeeded', url: 'https://example.com/result.mp4' };
  } }), true);
  assert.equal(requests, 1);
  const preview = harness();
  assert.equal(await executeGraph(graph, preview.callbacks, { nodeId: 'p', request: async () => { throw new Error('Preview must not call generation'); } }), true);
  assert.equal(preview.states.p.imageUrl, 'https://example.com/saved.png');
});

test('failed single-node retry keeps the last successful image and leaves other nodes unchanged', async () => {
  const graph = { nodes: [node('a', 'image-generate', { prompt: 'retry', imageUrl: 'https://example.com/last.png', images: ['https://example.com/last.png'] }), node('b', 'preview', { imageUrl: 'https://example.com/old-preview.png' })], edges: [edge('a', 'image', 'b', 'media')] };
  const previousB = structuredClone(graph.nodes[1]);
  const update = (id, patch) => Object.assign(graph.nodes.find((n) => n.id === id).data, patch);
  assert.equal(await executeGraph(structuredClone(graph), { update }, { nodeId: 'a', request: async () => { throw new Error('generation failed'); } }), false);
  assert.equal(graph.nodes[0].data.status, 'error');
  assert.equal(graph.nodes[0].data.imageUrl, 'https://example.com/last.png');
  assert.deepEqual(graph.nodes[1], previousB);
});

test('single-node abort finishes cleanly without changing upstream or downstream outputs', async () => {
  const graph = { nodes: [node('a', 'image-generate', { imageUrl: 'https://example.com/a.png' }), node('b', 'image-generate', { prompt: 'edit' }), node('p', 'preview')], edges: [edge('a', 'image', 'b', 'image'), edge('b', 'image', 'p', 'media')] };
  const controller = new AbortController(), h = harness();
  assert.equal(await executeGraph(graph, h.callbacks, { nodeId: 'b', signal: controller.signal, request: async () => { controller.abort(); throw new DOMException('aborted', 'AbortError'); } }), false);
  assert.deepEqual(Object.keys(h.states), ['b']);
  assert.deepEqual(h.finished, [false]);
});


const { parseAppId, cleanRHSchema, rhPort, rhValues } = require('../src/runninghub.ts');
const rhSchema = cleanRHSchema(require('./fixtures/runninghub.json'));
const rhNode = (id, extra = {}) => node(id, 'runninghub', { rhSchema, rhValues: rhValues({ rhSchema }), ...extra });
test('RunningHub exact large ID and both official links resolve without number rounding', () => {
  const id = '2092254629307723778';
  for (const value of [id, 'https://www.runninghub.ai/zh-cn/ai-detail/' + id, 'https://www.runninghub.ai/zh-cn/call-api/api-detail/' + id + '?apiType=4']) assert.equal(parseAppId(value), id);
  assert.throws(() => parseAppId('https://evil.test/ai-detail/' + id));
  assert.throws(() => parseAppId('javascript:alert(1)'));
  assert.equal(rhSchema.fields.length, 9);
});
test('RunningHub dynamic ports retain three independent image inputs through save/import', () => {
  const graph = { nodes: [node('i', 'image-generate'), rhNode('rh')], edges: ['137','139','142'].map(id => edge('i', 'image', 'rh', 'rh:' + id + ':image')) };
  const restored = normalizeWorkflow(portableWorkflow(graph));
  assert.equal(restored.edges.length, 3);
  assert.deepEqual(restored.nodes[1].data.rhSchema, rhSchema);
  assert.match(connectionError({ ...graph, edges: [] }, 'i', 'rh', 'image', 'rh:143:audio'), /相同类型/);
  assert.throws(() => normalizeWorkflow({ ...graph, edges: [edge('i','image','rh','rh:999:image')] }), /不存在/);
});
test('RunningHub single run sends connected images separately with exact application and field IDs', async () => {
  const h = harness(), calls = [];
  const graph = { nodes: [node('a', 'image-generate', { imageUrl: 'https://img.test/a.png' }), node('b','image-generate',{imageUrl:'https://img.test/b.png'}), rhNode('rh')], edges: [edge('a','image','rh','rh:137:image'),edge('b','image','rh','rh:139:image')] };
  const ok = await executeGraph(graph, h.callbacks, { nodeId: 'rh', pollInterval: 0, request: async (path, init) => {
    calls.push(path);
    if (path === '/api/generate-video') {
      const body = JSON.parse(init.body);
      assert.equal(body.params.appId, rhSchema.appId);
      assert.equal(body.flavor,'runninghub');
      const values = Object.fromEntries(body.params.nodeInfoList.map(f => [f.nodeId + ':' + f.fieldName, f.fieldValue]));
      assert.equal(values['137:image'], 'https://img.test/a.png'); assert.equal(values['139:image'], 'https://img.test/b.png');
      assert.equal(values['142:image'], rhSchema.fields.find(f=>f.nodeId==='142').fieldValue);
      assert.equal(values['115:megapixels'],'0.8');
      return { taskId: 'rh-task', status:'running' };
    }
    return { status:'succeeded', results:[{outputType:'png',url:'https://img.test/result.png'},{outputType:'mp3',url:'https://img.test/result.mp3'},{outputType:'txt',text:'done'}] };
  } });
  assert.equal(ok,true); assert.equal(calls.length,2);
  assert.equal(h.states.rh.imageUrl,'https://img.test/result.png'); assert.equal(h.states.rh.audioUrl,'https://img.test/result.mp3');
  assert.equal(h.states.a,undefined);
  const next = harness();
  await executeGraph({nodes:[rhNode('rh',h.states.rh),node('next','image-generate',{prompt:'edit'})],edges:[edge('rh','image','next','image')]},next.callbacks,{nodeId:'next',request:async(_,init)=>{assert.equal(JSON.parse(init.body).params.image,h.states.rh.imageUrl);return {images:['https://img.test/next.png']};}});
  assert.equal(next.states.next.status,'completed');
});
test('RunningHub missing upstream output and invalid numeric values never submit', async () => {
  let calls = 0;
  for (const graph of [
    { nodes: [node('i','image-generate',{image:'https://img.test/reference.png'}),rhNode('rh')], edges:[edge('i','image','rh','rh:137:image')] },
    { nodes:[rhNode('rh',{rhValues:{'rh:115:megapixels':'999'}})],edges:[] }
  ]) { const h=harness(); assert.equal(await executeGraph(graph,h.callbacks,{nodeId:'rh',request:async()=>{calls++;}}),false); }
  assert.equal(calls,0);
});
test('public RunningHub metadata fetch is fixed-host, credential-free and validates errors', async () => {
  const { fetchRunninghubSchema, validateRunninghubSubmission } = await import('../../shared/runninghub-schema.js');
  const schema = await fetchRunninghubSchema(rhSchema.appId, async (url, init) => {
    assert.equal(url,'https://www.runninghub.ai/api/webapp/detail');
    assert.deepEqual(init.headers, {'Content-Type':'application/json'});
    assert.deepEqual(JSON.parse(init.body),{webappId:rhSchema.appId});
    return {ok:true,json:async()=>({code:0,data:{name:rhSchema.title,inputNodes:rhSchema.fields}})};
  });
  assert.equal(schema.fields.length,9);
  await assert.rejects(fetchRunninghubSchema('../bad',async()=>assert.fail()));
  await assert.rejects(fetchRunninghubSchema(rhSchema.appId,async()=>({ok:true,json:async()=>({code:500})})),/未公开/);
  assert.throws(()=>validateRunninghubSubmission({appId:'../bad',nodeInfoList:[]}));
});
test('RunningHub backend uses imported app ID and preserves mixed results; uploads accept fileName', async () => {
  const api = await import('../../server/runninghub.js');
  const original = global.fetch;
  try {
    global.fetch = async (url, init) => {
      assert.equal(url, 'https://www.runninghub.ai/openapi/v2/run/ai-app/' + rhSchema.appId);
      assert.equal(init.headers.Authorization, 'Bearer test-only');
      assert.deepEqual(JSON.parse(init.body).nodeInfoList,[{nodeId:'137',fieldName:'image',fieldValue:'https://img.test/a.png'}]);
      return {ok:true,text:async()=>JSON.stringify({taskId:'mock'})};
    };
    assert.equal((await api.submitRunninghub({params:{appId:rhSchema.appId,nodeInfoList:[{nodeId:'137',fieldName:'image',fieldValue:'https://img.test/a.png'}]},auth:{rhKey:'test-only'}})).taskId,'mock');
    global.fetch = async()=>({ok:true,text:async()=>JSON.stringify({status:'SUCCESS',results:[{text:'text result',outputType:'txt'}]})});
    assert.equal((await api.getRunninghubStatus({taskId:'mock',auth:{rhKey:'test-only'}})).results[0].text,'text result');
    global.fetch = async()=>({ok:true,text:async()=>JSON.stringify({data:{fileName:'openapi/audio.mp3',download_url:'https://img.test/audio.mp3'}})});
    assert.equal((await api.uploadRunninghub({buffer:Buffer.from('mock'),filename:'audio.mp3',auth:{rhKey:'test-only'}})).filename,'openapi/audio.mp3');
  } finally { global.fetch=original; }
});

const { historyNodeData, readHistory, saveToMainHistory } = require('../src/history.ts');
test('preview exposes relay outputs and forwards cached selected image to next generation', async () => {
  const graph = normalizeWorkflow({nodes:[node('p','preview',{imageUrl:'https://img.test/selected.png',images:['https://img.test/first.png','https://img.test/selected.png']}),node('g','image-generate',{prompt:'edit'})],edges:[edge('p','image','g','image')]});
  const h=harness();
  assert.equal(await executeGraph(graph,h.callbacks,{nodeId:'g',request:async(_,init)=>{assert.equal(JSON.parse(init.body).params.image,'https://img.test/selected.png');return {images:['https://img.test/new.png']};}}),true);
});
test('history result survives full runs and passes through preview without generation', async () => {
  const data=historyNodeData({type:'image',src:'https://img.test/a.png',images:['https://img.test/a.png','https://img.test/b.png'],prompt:'reference'},'https://img.test/b.png');
  const graph=normalizeWorkflow({nodes:[node('h','result',data),node('p','preview')],edges:[edge('h','image','p','media')]});
  const h=harness();
  assert.equal(await executeGraph(graph,h.callbacks,{request:async()=>assert.fail('must not submit')}),true);
  assert.equal(h.states.h.imageUrl,'https://img.test/b.png');assert.equal(h.states.p.imageUrl,'https://img.test/b.png');
  assert.equal(normalizeWorkflow(portableWorkflow(graph)).nodes[0].data.imageUrl,'https://img.test/b.png');
});
test('preview relays audio and text using matching outputs', async () => {
  for (const [type,src,key] of [['audio','https://img.test/a.mp3','audioUrl'],['text','hello','text']]) {
    const graph=normalizeWorkflow({nodes:[node('h','result',historyNodeData({type,src})),node('p','preview')],edges:[edge('h',type,'p','media')]});
    const h=harness();assert.equal(await executeGraph(graph,h.callbacks),true);assert.equal(h.states.p[key],src);
  }
});
test('history rejects unsafe media and shares persisted entries with size limit and update notification', () => {
  assert.throws(()=>historyNodeData({type:'image',src:'javascript:alert(1)'}),/无效/);
  const oldStorage=global.localStorage, oldWindow=global.window;const events=[];
  let stored=JSON.stringify(Array.from({length:50},()=>({type:'image',src:'https://img.test/old.png'})));
  global.localStorage={getItem:()=>stored,setItem:(_,v)=>{stored=v;}};
  global.window={dispatchEvent:e=>events.push(e.type)};
  try {saveToMainHistory({type:'video',src:'https://img.test/new.mp4'});assert.equal(readHistory().length,50);assert.equal(readHistory()[0].type,'video');assert.ok(events.includes('canvas-history-change'));}
  finally {global.localStorage=oldStorage;global.window=oldWindow;}
});
