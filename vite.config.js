import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

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
    __COMMIT_SHA__: JSON.stringify(resolveVersion()),
  },
  build: {
    outDir: 'dist',
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
