import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const WORKSPACE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const REMOVED_DEPENDENCY_URL_PREFIXES = [
  'https://reactjs.org/',
  'http://reactjs.org/',
  'https://react.dev/',
  'http://react.dev/',
  'https://leafletjs.com',
  'http://leafletjs.com',
  'https://www.spatialillusions.com',
  'http://www.spatialillusions.com',
  'https://locize.com',
  'http://locize.com',
  'https://www.i18next.com',
  'http://www.i18next.com',
  'https://maplibre.org/',
  'http://maplibre.org/',
  'https://wiki.openstreetmap.org/',
  'http://wiki.openstreetmap.org/',
] as const;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'remove-dependency-help-links',
      apply: 'build',
      generateBundle(_options, bundle) {
        for (const artifact of Object.values(bundle)) {
          if (artifact.type !== 'chunk') continue;
          for (const prefix of REMOVED_DEPENDENCY_URL_PREFIXES) {
            artifact.code = artifact.code.split(prefix).join('urn:aurora:removed');
          }
        }
      },
    },
  ],
  base: '/',
  optimizeDeps: {
    // MapLibre creates its worker at runtime. Pre-bundling can leave Vite
    // pointing at a stale maplibre-gl-worker.mjs after dependency changes.
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    // npm hoists MapLibre to the workspace root. Limit development file
    // serving to that exact local workspace so its worker can load.
    fs: { allow: [WORKSPACE_ROOT] },
    proxy: Object.fromEntries(['/api', '/assets'].map((prefix) => [prefix, {
      target: `http://127.0.0.1:${process.env.AURORA_DEV_API_PORT ?? '8474'}`,
      changeOrigin: true,
      configure(proxy) {
        proxy.on('proxyReq', (request) => request.setHeader('origin', `http://127.0.0.1:${process.env.AURORA_DEV_API_PORT ?? '8474'}`));
      },
    }])),
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
});
