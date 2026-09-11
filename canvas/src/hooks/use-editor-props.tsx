import { useMemo } from 'react';
import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { FreeLayoutProps, WorkflowNodeProps, WorkflowNodeRenderer, useNodeRender, useWatchFormValues, WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { nodeRegistries } from '../nodes';
import { initialData } from '../initial-data';
import { connectionError, getDefinition, NodeData } from '../workflow';
import { notify } from '../api';
function NodeRenderer(props: WorkflowNodeProps) {
  const { node, form } = useNodeRender();
  const data = useWatchFormValues<NodeData>(node);
  const color = getDefinition(String(node.flowNodeType))?.color || '#8d95a5';
  return <WorkflowNodeRenderer node={props.node} className={'workflow-node ' + (data?.status || 'idle')} portClassName="workflow-port" portPrimaryColor={color} portSecondaryColor={color} portBackgroundColor="#202229">{form?.render()}</WorkflowNodeRenderer>;
}
export const useEditorProps = (data: WorkflowJSON = initialData) => useMemo<FreeLayoutProps>(() => ({
  background: { gridSize: 24, dotSize: 1, dotColor: '#50576b', dotOpacity: 0.45, backgroundColor: '#15171c' }, readonly: false, initialData: data, nodeRegistries,
  allNodesDefaultExpanded: true,
  nodeEngine: { enable: true },
  history: { enable: true, enableChangeNode: true },
  onContentChange() { window.dispatchEvent(new Event('canvas-change')); },
  materials: { renderDefaultNode: (props) => <NodeRenderer {...props} /> },
  canAddLine(ctx, from, to, lines, silent) {
    const source = from.portType === 'output' ? from : to;
    const target = from.portType === 'input' ? from : to;
    if (source.portType !== 'output' || target.portType !== 'input') return false;
    const graph = { ...ctx.document.toJSON(), edges: lines.getAllAvailableLines().map((line) => line.toJSON()) };
    const error = connectionError(graph, source.node.id, target.node.id, String(source.portID), String(target.portID));
    if (error && !silent) notify(error);
    return !error;
  },
  canResetLine(ctx, oldLine, next, lines) {
    const graph = { ...ctx.document.toJSON(), edges: lines.getAllAvailableLines().filter((line) => line.id !== oldLine.id).map((line) => line.toJSON()) };
    const error = connectionError(graph, next.from, next.to, String(next.fromPort), String(next.toPort));
    if (error) notify(error);
    return !error;
  },
  isDisabledPort(_ctx, port) { return port.portID === 'flow' && !port.availableLines.length && !['start', 'end'].includes(String(port.node.flowNodeType)); },
  setLineClassName(_ctx, line) { return 'edge-' + (line.toJSON().sourcePortID || 'flow'); },
  onAllLayersRendered(ctx) { ctx.document.fitView(false); },
  plugins: () => [
    createMinimapPlugin({ disableLayer: true, canvasStyle: { canvasWidth: 174, canvasHeight: 106, canvasPadding: 40, canvasBackground: '#191b21', nodeColor: '#626b8d', nodeBorderColor: '#7b84a6', viewportBackground: 'rgba(150,163,245,0.12)', viewportBorderColor: '#8695e3', viewportBorderWidth: 1, canvasBorderRadius: 8 } }),
    createFreeSnapPlugin({ edgeColor: '#8598ee', alignColor: '#8598ee' }),
  ],
}), [data]);
