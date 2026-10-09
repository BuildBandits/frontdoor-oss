import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
  return `v${packageJson.version}`;
}

export default defineConfig({
  plugins: [react()],
  root: '.',
  define: {
    __APP_VERSION__: JSON.stringify(readPackageVersion()),
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        // Groups pull in their dependencies recursively, so React core must win
        // on priority; otherwise libraries importing React (e.g. @dnd-kit) absorb it.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 40 },
            { name: 'vendor-icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 30 },
            { name: 'vendor-dnd', test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/, priority: 20 },
            { name: 'vendor-shared', test: /[\\/]node_modules[\\/](dompurify|axios|zustand|uuid)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
