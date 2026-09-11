import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  server: {
    port: 3002,
    proxy: { '/api': { target: process.env.CANVAS_API_TARGET || 'http://localhost:3000', changeOrigin: true } },
  },
  html: {
    title: '熙梦AI 工作流画布',
  },
  output: {
    // 相对路径，方便集成到任意子目录部署
    assetPrefix: './',
  },
});
