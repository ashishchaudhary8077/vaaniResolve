import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

// The backend port lives in the repo-root `.env` — the authoritative config
// source (see apps/server/src/loadEnv.ts). The server reads it with
// `dotenv.config({ override: true })`, so the file value wins over any global
// `PORT`. Read the same file directly here so the dev proxy and the server
// always agree, instead of hardcoding a port (or trusting process.env) that can
// drift from what the server actually binds.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const envPath = path.join(repoRoot, '.env');
const fileEnv = fs.existsSync(envPath) ? parseDotenv(fs.readFileSync(envPath, 'utf8')) : {};
const backendPort = fileEnv.PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${backendPort}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});