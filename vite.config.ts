import { defineConfig } from 'vite';

export default defineConfig({
  // Pages builds set the repository subpath; ordinary local builds stay at /.
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
