import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  cacheDir: './.vite',
  css: { postcss: { plugins: [] } },
  server: {
    host: '127.0.0.1',
    port: 3101,
    strictPort: true,
    proxy: { '/api/platform': 'http://127.0.0.1:3100' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
