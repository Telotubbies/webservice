import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { mockApi } from './mock/devApi.ts';

// Backend per contract: FastAPI serves REST under /api, WS at /ws.
// Host port follows BACKEND_PORT (compose default 8000; this box maps 8001).
declare const process: { env: Record<string, string | undefined> };
const API_TARGET = `http://localhost:${process.env.BACKEND_PORT || '8000'}`;

// MOCK_API=1 serves /api from web/mock/devApi.ts instead of the backend.
const MOCK = process.env.MOCK_API === '1';

const proxy = {
  ...(MOCK ? {} : {
    '/api': { target: API_TARGET, changeOrigin: true },
    '/ws': { target: API_TARGET, ws: true, changeOrigin: true },
  }),
  // same-origin Keycloak — wds realm + login assets only
  '/realms/wds': { target: 'http://localhost:8080', changeOrigin: true },
  '/resources': { target: 'http://localhost:8080', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(MOCK ? [mockApi()] : [])],
  build: {
    // never inline fonts — CSP allows fonts from 'self' only
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: { port: 5199, strictPort: true, proxy },
  preview: { port: 5199, proxy },
});
