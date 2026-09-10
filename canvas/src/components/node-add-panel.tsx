/**
 * 节点添加面板 - 熙梦AI 工作流
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import React from 'react';

import {
  WorkflowDocument,
  WorkflowDragService,
  useClientContext,
  useService,
} from '@flowgram.ai/free-layout-editor';

const cardkeys = ['ImageGenerate', 'VideoGenerate'];

export const NodeAddPanel: React.FC = () => {
  const startDragService = useService(WorkflowDragService);
  const workflowDocument = useService(WorkflowDocument);
  const context = useClientContext();

  return (
    <div className="demo-free-sidebar">
      {cardkeys.map((nodeType) => (
        <div
          key={nodeType}
          className="demo-free-card"
          onMouseDown={async (e) => {
            const type = nodeType.toLowerCase();
            const registry = workflowDocument.getNodeRegistry(type);
            const json = registry.onAdd?.(context);
            await startDragService.startDragCard(type, e, {
              ...json,
              data: {
                title: `New ${nodeType}`,
                content: '',
              },
            });
          }}
        >
          {nodeType}
        </div>
      ))}
    </div>
  );
};
