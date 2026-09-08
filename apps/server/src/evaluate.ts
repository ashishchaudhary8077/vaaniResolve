/**
 * VaaniResolve performance evaluation (spec section 12).
 * Executes each demo mode N times, measures REAL timings, and writes a report
 * into /evaluation/results. Never fabricates — every number is measured.
 *
 * Usage: npm run eval  [samples]
 */

import './loadEnv.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConversationManager } from '@vaaniresolve/state';
import { Agent } from '@vaaniresolve/agent';
import { loadRimeConfig } from '@vaaniresolve/rime';
import { ConversationEngine, type EngineSpeak } from './engine.js';
import { Metrics } from './metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = Number(process.argv[2] ?? 3);
const rimeConfig = loadRimeConfig(process.env);
const agent = new Agent(process.env.ANTHROPIC_API_KEY ?? '', process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-1');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeEngine() {
  const conversation = new ConversationManager(`eval_${Date.now().toString(36)}`);
  const metrics = new Metrics();
  const uttered: string[] = [];
  const speak: EngineSpeak = async (u) => void uttered.push(u.text);
  const engine = new ConversationEngine({ conversation, agent, rimeConfig, metrics, speak, events: { send: () => undefined } });
  return { engine, conversation, metrics, uttered };
}

interface RunResult {
  mode: string;
  turnTimeMs: number;
  llmMs: number;
  toolMs: number;
  staleDiscarded: number;
  interruptCount: number;
  spokenFirst: string;
  ok: boolean;
}

async function runMode(mode: string): Promise<RunResult> {
  const { engine, conversation, metrics, uttered } = makeEngine();
  const t0 = Date.now();
  switch (mode) {
    case 'normal': {
      await engine.handleUserSpeech({ transcript: 'Where are my headphones?', requestId: 'e1' });
      break;
    }
    case 'context_continuity': {
      await engine.handleUserSpeech({ transcript: 'Where are my blue headphones?', requestId: 'e1' });
      await engine.handleUserSpeech({ transcript: 'When will it arrive?', requestId: 'e2' });
      await engine.handleUserSpeech({ transcript: 'Cancel them.', requestId: 'e3' });
      break;
    }
    case 'interrupt': {
      engine.setToolOverrides({ latency: { trackOrder: 3000, getOrder: 3000 } });
      const t1 = engine.handleUserSpeech({ transcript: 'Where is my laptop?', requestId: 'e1' });
      await sleep(300);
      engine.setToolOverrides({ latency: {} });
      await engine.handleUserSpeech({ transcript: 'Wait, I mean my blue headphones.', requestId: 'e2' });
      await t1;
      break;
    }
    default:
      throw new Error(`unknown mode ${mode}`);
  }
  const turnTimeMs = Date.now() - t0;
  const snap = metrics.snapshot();
  const last = snap.latencies.at(-1) ?? {};
  await sleep(200); // let any give-up settle
  void conversation;
  return {
    mode,
    turnTimeMs,
    llmMs: last.llmMs ?? 0,
    toolMs: last.toolLatencyMs ?? 0,
    staleDiscarded: snap.staleResultsDiscarded,
    interruptCount: snap.interruptCount,
    spokenFirst: uttered[0]?.slice(0, 80) ?? '',
    ok: uttered.length > 0,
  };
}

async function main() {
  const modes = ['normal', 'context_continuity', 'interrupt'];
  const report: { samples: number; runs: RunResult[]; summary: Record<string, { avgTurnMs: number; avgLlmMs: number; avgToolMs: number; stale: number; interrupts: number; ok: boolean }> } = { samples, runs: [], summary: {} };
  for (const mode of modes) {
    const runs: RunResult[] = [];
    for (let i = 0; i < samples; i++) runs.push(await runMode(mode));
    const avg = (k: keyof Pick<RunResult, 'turnTimeMs' | 'llmMs' | 'toolMs'>) => Math.round(runs.reduce((a, r) => a + (r[k] as number), 0) / runs.length);
    report.summary[mode] = {
      avgTurnMs: avg('turnTimeMs'),
      avgLlmMs: avg('llmMs'),
      avgToolMs: avg('toolMs'),
      stale: Math.max(...runs.map((r) => r.staleDiscarded)),
      interrupts: Math.max(...runs.map((r) => r.interruptCount)),
      ok: runs.every((r) => r.ok),
    };
    report.runs.push(...runs);
  }
  report.runs = report.runs.slice(-samples * modes.length);

  const outDir = join(__dirname, '..', '..', '..', 'evaluation', 'results');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `eval_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`report written: ${file}`);
}

void main();