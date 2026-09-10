/**
 * 熙梦AI 工作流画布 - 编辑器配置
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import { useMemo } from 'react';

import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import {
  FreeLayoutProps,
  WorkflowNodeProps,
  WorkflowNodeRenderer,
  Field,
  useNodeRender,
  FlowNodeMeta,
} from '@flowgram.ai/free-layout-editor';
import { createContainerNodePlugin } from '@flowgram.ai/free-container-plugin';

import { nodeRegistries } from '../nodes';
import { initialData } from '../initial-data';

export const useEditorProps = () =>
  useMemo<FreeLayoutProps>(
    () => ({
      background: true,
      readonly: false,
      initialData,
      nodeRegistries,
      fromNodeJSON(node, json) {
        return json;
      },
      toNodeJSON(node, json) {
        return json;
      },
      getNodeDefaultRegistry(type) {
        return {
          type,
          meta: {
            defaultExpanded: true,
          },
          formMeta: {
            render: () => (
              <>
                <Field<string> name="title">
                  {({ field }) => <div className="demo-free-node-title">{field.value}</div>}
                </Field>
                <div className="demo-free-node-content">
                  <Field<string> name="content">
                    <input />
                  </Field>
                </div>
              </>
            ),
          },
        };
      },
      materials: {
        renderDefaultNode: (props: WorkflowNodeProps) => {
          const { node, form } = useNodeRender();
          const meta = node.getNodeMeta<FlowNodeMeta>();
          return (
            <WorkflowNodeRenderer
              className="demo-free-node"
              node={props.node}
              style={meta.wrapperStyle}
            >
              {form?.render()}
            </WorkflowNodeRenderer>
          );
        },
      },
      onContentChange(ctx) {
        // 自动保存（后续接入数据库）
      },
      history: {
        enable: true,
        enableChangeNode: true,
      },
      onAllLayersRendered(ctx) {
        ctx.document.fitView(false);
      },
      plugins: () => [
        createMinimapPlugin({
          disableLayer: true,
          canvasStyle: {
            canvasWidth: 182,
            canvasHeight: 102,
            canvasPadding: 50,
            canvasBackground: 'rgba(245, 245, 245, 1)',
            canvasBorderRadius: 10,
            viewportBackground: 'rgba(235, 235, 235, 1)',
            viewportBorderRadius: 4,
            viewportBorderColor: 'rgba(201, 201, 201, 1)',
            viewportBorderWidth: 1,
            viewportBorderDashLength: 2,
            nodeColor: 'rgba(255, 255, 255, 1)',
            nodeBorderRadius: 2,
            nodeBorderWidth: 0.145,
            nodeBorderColor: 'rgba(6, 7, 9, 0.10)',
            overlayColor: 'rgba(255, 255, 255, 0)',
          },
        }),
        createFreeSnapPlugin({
          edgeColor: '#00B2B2',
          alignColor: '#00B2B2',
          edgeLineWidth: 1,
          alignLineWidth: 1,
          alignCrossWidth: 8,
        }),
        createContainerNodePlugin({}),
      ],
    }),
    []
  );
