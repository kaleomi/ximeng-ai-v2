import { createElement } from 'react';
import type { WorkflowNodeRegistry } from '@flowgram.ai/free-layout-editor';
import { NODE_CATALOG, RH_DEFINITION, RESULT_DEFINITION } from '../workflow';
import { NodeForm } from '../components/node-form';
export const nodeRegistries: WorkflowNodeRegistry[] = [...NODE_CATALOG, RH_DEFINITION, ...['start', 'end'].map((type) => ({ type, title: type === 'start' ? '开始' : '结束', inputs: [], output: undefined, defaults: {} }))].map((item) => ({
  type: item.type,
  meta: {
    defaultExpanded: true,
    useDynamicPort: ['runninghub', 'preview', 'result'].includes(item.type),
    defaultPorts: [
      ...item.inputs.map((port, i) => ({ portID: port, type: 'input' as const, location: 'left' as const, locationConfig: { left: 0, top: 63 + i * 30 } })),
      ...(item.output ? [{ portID: item.output, type: 'output' as const, location: 'right' as const, locationConfig: { right: 0, top: 63 } }] : []),
      { portID: 'flow', type: 'input' as const, location: 'left' as const, locationConfig: { left: 0, top: 22 } },
      { portID: 'flow', type: 'output' as const, location: 'right' as const, locationConfig: { right: 0, top: 22 } },
    ],
  },
  onAdd: () => ({ data: { title: item.title, ...item.defaults, status: 'idle' } }),
  formMeta: { render: () => createElement(NodeForm) },
}));
