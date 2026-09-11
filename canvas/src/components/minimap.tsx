import { MinimapRender } from '@flowgram.ai/minimap-plugin';
export const Minimap = () => <div className="canvas-minimap"><MinimapRender containerStyles={{ pointerEvents: 'auto', position: 'relative', top: 'unset', right: 'unset', bottom: 'unset', left: 'unset' }} inactiveStyle={{ opacity: 1, scale: 1, translateX: 0, translateY: 0 }} /></div>;
