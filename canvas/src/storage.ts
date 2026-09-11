import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { normalizeWorkflow } from './workflow';
let database: Promise<IDBDatabase> | undefined;
let protectUnreadableDraft = false;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ximeng-canvas', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workflows');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('本机存储被其他窗口占用')); };
  });
  return database;
}
export function portableWorkflow(graph: WorkflowJSON): WorkflowJSON {
  return { nodes: (graph.nodes || []).map((n) => {
    const data = { ...n.data, status: 'idle', error: '' };
    delete data.preview;
    return { ...n, data };
  }), edges: graph.edges || [] };
}
export async function saveDraft(graph: WorkflowJSON) {
  if (protectUnreadableDraft) throw new Error('为保留未能读取的草稿，请先导出当前工作流');
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workflows', 'readwrite');
    tx.objectStore('workflows').put(portableWorkflow(graph), 'draft');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存中断'));
  });
}
export async function loadDraft(): Promise<WorkflowJSON | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('workflows').objectStore('workflows').get('draft');
    request.onsuccess = () => { try { resolve(request.result ? normalizeWorkflow(request.result) : null); } catch (e) { protectUnreadableDraft = true; reject(e); } };
    request.onerror = () => reject(request.error);
  });
}
