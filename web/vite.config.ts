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
      // same-origin Keycloak (v4 T5) — mirrors nginx.conf
      '/realms': { target: 'http://localhost:8080', changeOrigin: true },
      '/resources': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'http://localhost:8000', ws: true, changeOrigin: true },
      '/realms': { target: 'http://localhost:8080', changeOrigin: true },
      '/resources': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
