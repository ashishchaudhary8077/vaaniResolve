#!/usr/bin/env node
/**
 * Secret scan for VaaniResolve.
 * Looks for common API-key shapes in tracked files, ignoring node_modules,
 * dist, .git, and evaluation fixtures. Fails (exit 1) if anything looks like a
 * real credential so nobody accidentally ships a key.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ignored = [
  'node_modules', 'dist', 'build', '.git', '.next', 'coverage', '.env',
  'package-lock.json', 'evaluation/results',
];

const patterns = [
  /(sk-[A-Za-z0-9_\-]{20,})/,             // OpenAI/Anthropic-style keys
  /(sk-ant-[A-Za-z0-9_\-]{40,})/,          // Anthropic
  /(AKIA[0-9A-Z]{16})/,                    // AWS
  /(AIza[0-9A-Za-z_\-]{35})/,              // Google
  /(['"]?(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,})/,
  /(xox[baprs]-[A-Za-z0-9\-]{10,})/,       // Slack
  /(Bearer\s+[A-Za-z0-9._\-]{20,})/,
];

const files = execFileSync('git', ['ls-files'], { encoding: 'utf-8' })
  .split('\n')
  .filter((f) => f && !ignored.some((i) => f.includes(i)));

let hits = 0;
for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  for (const re of patterns) {
    const m = content.match(re);
    if (m) {
      console.error(`⚠ potential secret in ${file}: ${m[0].slice(0, 12)}…`);
      hits++;
    }
  }
}

if (hits) {
  console.error(`\nFound ${hits} potential secret(s). Refusing to continue.`);
  process.exit(1);
}
console.log('✓ no secrets found in tracked files');