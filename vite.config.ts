import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { prelaunchPlugin } from './prelaunch/build';
import { furniturePlugin } from './furniture/build';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [furniturePlugin(), prelaunchPlugin(), react()],
      build: { rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), furniture: path.resolve(__dirname, 'furniture/index.html') } } },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
