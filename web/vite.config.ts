import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend per CONTRACT.md: FastAPI on :8000, REST under /api, WS at /ws.
export default defineConfig({
  plugins: [react()],
  build: {
    // Never inline fonts as data: URIs — the CSP allows fonts from 'self' only.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'http://localhost:8000', ws: true, changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'http://localhost:8000', ws: true, changeOrigin: true },
    },
  },
});
