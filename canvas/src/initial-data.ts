import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
export const initialData: WorkflowJSON = {
  nodes: [
    { id: 'text_0001', type: 'text', meta: { position: { x: 60, y: 90 } }, data: { title: '提示词', text: '一只戴着宇航头盔的橘猫，漂浮在太空站窗外，蔚蓝地球为背景，电影光照，丰富的毛发细节。' } },
    { id: 'image_0002', type: 'image-generate', meta: { position: { x: 450, y: 90 } }, data: { title: '图片生成', model: 'doubao-seedream-5-0-260128', size: '1024x1024', quality: 'auto', count: 1 } },
    { id: 'preview_0003', type: 'preview', meta: { position: { x: 870, y: 90 } }, data: { title: '预览结果' } },
  ],
  edges: [
    { sourceNodeID: 'text_0001', sourcePortID: 'text', targetNodeID: 'image_0002', targetPortID: 'text' },
    { sourceNodeID: 'image_0002', sourcePortID: 'image', targetNodeID: 'preview_0003', targetPortID: 'media' },
  ],
};
