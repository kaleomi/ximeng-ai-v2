import { saveToMainHistory } from './history';
export { saveToMainHistory } from './history';
import type { WorkflowDocument, FormModelV2 } from '@flowgram.ai/free-layout-editor';
import { getFormModel } from '@flowgram.ai/form-core';
import { executeGraph, RunCallbacks, RunOptions } from './runner';
import type { NodeData } from './workflow';
export type ExecuteCallbacks = Partial<Omit<RunCallbacks, 'update'>>;
export function setNodeValues(doc: WorkflowDocument, id: string, patch: Partial<NodeData>) {
  const node = doc.getNode(id);
  if (!node) return;
  const form = getFormModel(node) as FormModelV2;
  Object.entries(patch).forEach(([key, value]) => form.setValueIn(key, value));
}
export async function executeWorkflow(doc: WorkflowDocument, callbacks: ExecuteCallbacks = {}, options: RunOptions = {}) {
  const graph = structuredClone(doc.toJSON());
  return executeGraph(graph, { ...callbacks, update: (id, patch) => setNodeValues(doc, id, patch), onResult: saveToMainHistory }, options);
}
export function resetWorkflowStatus(doc: WorkflowDocument) {
  for (const node of doc.toJSON().nodes || []) {
    if (node.data?.status !== 'uploading') setNodeValues(doc, node.id, { status: 'idle', error: '' });
  }
}
