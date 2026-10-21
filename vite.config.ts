import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { prelaunchPlugin } from './prelaunch/build';
import { furniturePlugin } from './furniture/build';

/**
 * Inlines each page's stylesheet into its HTML. Both pages paint their hero from HTML
 * alone, and an inline stylesheet saves the round trip that would otherwise hold
 * that first paint back on a phone connection.
 */
function inlineEntryCss(pages: string[]): Plugin {
  return {
    name: 'louie-mae-inline-entry-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const page = path.relative(__dirname, ctx.filename).replace(/\\/g, '/');
        if (!pages.includes(page) || !ctx.bundle) return html;
        return html.replace(/<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/g, (tag, file: string) => {
          const asset = ctx.bundle![file];
          return asset && asset.type === 'asset' ? `<style>${String(asset.source)}</style>` : tag;
        });
      },
    },
  };
}

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [furniturePlugin(), prelaunchPlugin(), react(), inlineEntryCss(['index.html', 'trade/index.html'])],
      build: { rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), furniture: path.resolve(__dirname, 'furniture/index.html'), trade: path.resolve(__dirname, 'trade/index.html') } } },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
