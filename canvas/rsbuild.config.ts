import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    title: '熙梦AI 工作流画布',
  },
  output: {
    // 相对路径，方便集成到任意子目录部署
    assetPrefix: './',
  },
});
