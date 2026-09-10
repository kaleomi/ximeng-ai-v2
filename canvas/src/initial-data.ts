/**
 * 初始画布数据 - 熙梦AI 工作流
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import { WorkflowJSON } from '@flowgram.ai/free-layout-editor';

export const initialData: WorkflowJSON = {
  nodes: [
    {
      id: 'start_0',
      type: 'start',
      meta: {
        position: { x: 86.5, y: 200 },
      },
      data: {
        title: '开始',
      },
    },
    {
      id: 'image_0',
      type: 'image-generate',
      meta: {
        position: { x: 450, y: 120 },
      },
      data: {
        title: '图片生成',
      },
    },
    {
      id: 'video_0',
      type: 'video-generate',
      meta: {
        position: { x: 900, y: 200 },
      },
      data: {
        title: '视频生成',
      },
    },
    {
      id: 'end_0',
      type: 'end',
      meta: {
        position: { x: 1380, y: 200 },
      },
      data: {
        title: '结束',
      },
    },
  ],
  edges: [
    { sourceNodeID: 'start_0', targetNodeID: 'image_0' },
    { sourceNodeID: 'image_0', targetNodeID: 'video_0' },
    { sourceNodeID: 'video_0', targetNodeID: 'end_0' },
  ],
};
