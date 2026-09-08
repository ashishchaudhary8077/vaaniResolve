/**
 * Load the monorepo-root `.env` regardless of the process working directory.
 *
 * `npm run dev` runs this workspace with cwd = apps/server, so a bare
 * `import 'dotenv/config'` looks for apps/server/.env and finds nothing — the
 * root .env (which holds RIME_API_KEY and friends) is silently skipped, and Rime
 * would fall back to non-Rime TTS. Resolving from the module location (not cwd)
 * makes env loading deterministic no matter how the process is launched.
 *
 * `.env` is the authoritative config source for this repo (mirrored in
 * `.env.example`). Pre-existing values in the process environment (e.g. Windows
 * user env vars) would otherwise shadow it and, being unconfigurable in code,
 * make the app behave differently per-machine — so override them with the
 * repo's own configuration. Secrets still never leave the server.
 */

import path from 'node:path';
import dotenv from 'dotenv';

// apps/server/src -> repo root (3 levels up).
const repoRoot = path.resolve(import.meta.dirname, '../../..');

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true, override: true });
