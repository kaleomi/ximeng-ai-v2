/**
 * 示例工作流（一键加载演示：文本 → 图片生成 → 视频生成 → 结束）
 */
import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';

export const SAMPLE_WORKFLOW: WorkflowJSON = {
  nodes: [
    {
      id: 'start_sample',
      type: 'start',
      meta: { position: { x: 60, y: 220 } },
      data: { title: '开始' },
    },
    {
      id: 'text_sample',
      type: 'text',
      meta: { position: { x: 300, y: 220 } },
      data: {
        title: '文本',
        text: '一只戴着宇航头盔的橘猫，漂浮在太空站窗外，蔚蓝地球为背景，电影级光照，超写实',
      },
    },
    {
      id: 'image_sample',
      type: 'image-generate',
      meta: { position: { x: 560, y: 220 } },
      data: {
        title: '图片生成',
        model: 'doubao-seedream-5-0-260128',
        size: '1024x1024',
        n: 1,
      },
    },
    {
      id: 'video_sample',
      type: 'video-generate',
      meta: { position: { x: 950, y: 220 } },
      data: {
        title: '视频生成',
        model: 'doubao-seedance-2.5',
        duration: 5,
      },
    },
    {
      id: 'end_sample',
      type: 'end',
      meta: { position: { x: 1350, y: 220 } },
      data: { title: '结束' },
    },
  ],
  edges: [
    { sourceNodeID: 'start_sample', targetNodeID: 'text_sample' },
    { sourceNodeID: 'text_sample', targetNodeID: 'image_sample' },
    { sourceNodeID: 'image_sample', targetNodeID: 'video_sample' },
    { sourceNodeID: 'video_sample', targetNodeID: 'end_sample' },
  ],
};
