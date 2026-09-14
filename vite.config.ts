import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { prelaunchPlugin } from './prelaunch/build';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [prelaunchPlugin(), react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
