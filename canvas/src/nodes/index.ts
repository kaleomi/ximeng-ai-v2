/**
 * 节点注册表 - 熙梦AI 工作流
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
import { WorkflowNodeRegistry } from '@flowgram.ai/free-layout-editor';

import { StartNodeRegistry } from './start';
import { EndNodeRegistry } from './end';
import { TextNodeRegistry } from './text';
import { ImageGenerateNodeRegistry } from './image-generate';
import { VideoGenerateNodeRegistry } from './video-generate';

export const nodeRegistries: WorkflowNodeRegistry[] = [
  StartNodeRegistry,
  TextNodeRegistry,
  ImageGenerateNodeRegistry,
  VideoGenerateNodeRegistry,
  EndNodeRegistry,
];
