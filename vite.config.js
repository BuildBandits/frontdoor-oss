import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
  return `v${packageJson.version}`;
}

function buildTimestamp() {
  // Compact UTC timestamp like "20260415-1147" so it reads as a short version string.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function resolveVersion() {
  // Resolution order:
  // 1. VITE_COMMIT_SHA env var (explicit escape hatch, wins over git)
  // 2. `git rev-parse --short HEAD` (local dev, works if .git is in the build context)
  // 3. UTC build timestamp (last-resort fallback — always works, always fresh per build)
  if (process.env.VITE_COMMIT_SHA) return process.env.VITE_COMMIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return buildTimestamp();
  }
}

export default defineConfig({
  plugins: [react()],
  root: '.',
  define: {
    __APP_VERSION__: JSON.stringify(readPackageVersion()),
    __COMMIT_SHA__: JSON.stringify(resolveVersion()),
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
            { name: 'vendor-shared', test: /[\\/]node_modules[\\/](dompurify|axios|zustand|clsx|uuid)[\\/]/, priority: 10 },
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
