import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': 'http://127.0.0.1:8474',
      '/assets': 'http://127.0.0.1:8474',
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
});
