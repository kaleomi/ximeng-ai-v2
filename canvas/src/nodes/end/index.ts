/**
 * 结束节点
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import { FlowNodeRegistry } from '@flowgram.ai/free-layout-editor';

export const EndNodeRegistry: FlowNodeRegistry = {
  type: 'end',
  meta: {
    isEnd: true,
    deleteDisable: true,
    copyDisable: true,
    defaultPorts: [{ type: 'input' }],
  },
};
