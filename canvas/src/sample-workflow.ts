import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import { newNodeData } from './workflow';
export const SAMPLE_WORKFLOW: WorkflowJSON = {
  nodes: [
    { id: 'text_sample', type: 'text', meta: { position: { x: 50, y: 30 } }, data: { ...newNodeData('text'), text: '镜头缓缓推进，画面主体自然运动，保留参考图的构图、色彩和光线，电影质感。' } },
    { id: 'upload_sample', type: 'image-upload', meta: { position: { x: 50, y: 450 } }, data: newNodeData('image-upload') },
    { id: 'video_sample', type: 'video-generate', meta: { position: { x: 470, y: 130 } }, data: newNodeData('video-generate') },
    { id: 'preview_sample', type: 'preview', meta: { position: { x: 900, y: 130 } }, data: newNodeData('preview') },
  ],
  edges: [
    { sourceNodeID: 'text_sample', sourcePortID: 'text', targetNodeID: 'video_sample', targetPortID: 'text' },
    { sourceNodeID: 'upload_sample', sourcePortID: 'image', targetNodeID: 'video_sample', targetPortID: 'image' },
    { sourceNodeID: 'video_sample', sourcePortID: 'video', targetNodeID: 'preview_sample', targetPortID: 'media' },
  ],
};
