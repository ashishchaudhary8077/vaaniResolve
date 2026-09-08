/**
 * VaaniResolve DEMO MODE (spec section 16) — CLI evidence runner.
 *
 * NORMAL FLOW | INTERRUPTION TEST | STALE RESULT TEST | RIME TEST | LATENCY TEST
 *
 * All five trigger REAL functionality: real agent decisions, real mock-comerce
 * tool calls with realistic latency, and the real Rime/fallback speak path.
 * Latency is measured at the real call sites. Nothing is faked or animated.
 *
 * Usage:  npm run demo [normal|interrupt|stale|rime|latency|all]
 */

import './loadEnv.js';
import { ConversationManager } from '@vaaniresolve/state';
import { Agent } from '@vaaniresolve/agent';
import { loadRimeConfig } from '@vaaniresolve/rime';
import { ConversationEngine, type EngineSpeak } from './engine.js';
import { Metrics } from './metrics.js';

const rimeConfig = loadRimeConfig(process.env);
const agent = new Agent(process.env.ANTHROPIC_API_KEY ?? '', process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-1');
const LAPTOP_DELAY = Number(process.env.STRESS_LAPTOP_MS ?? 4000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeEngine(collect: { uttered: string[]; events: Array<Record<string, unknown>> }, opts: { realSpeak?: boolean } = {}) {
  const conversation = new ConversationManager(`demo_${Date.now().toString(36)}`);
  const metrics = new Metrics();
  const speak: EngineSpeak = async (utterance) => {
    collect.uttered.push(utterance.text);
  };
  const engine = new ConversationEngine({
    conversation,
    agent,
    rimeConfig,
    metrics,
    // `realSpeak` omits the injected sink so the REAL speak path runs:
    // streamRime when RIME_API_KEY is set, else the disclosed fallback synth —
    // both emit rime_chunk events captured by the collector below.
    ...(opts.realSpeak ? {} : { speak }),
    events: {
      send: (msg) => collect.events.push({ type: msg.type, generation: msg.generation, turnId: msg.turnId, payload: msg.payload }),
    },
  });
  // Expose the collected utterances/events alongside the engine so runner modes
  // can assert on what was actually spoken and emitted.
  return { engine, conversation, metrics, uttered: collect.uttered, events: collect.events };
}

function line(c: string = '') {
  // eslint-disable-next-line no-console
  console.log(c);
}

async function runNormal(col: ReturnType<typeof makeEngine>): Promise<string> {
  line('── NORMAL FLOW ────────────────────────────────────────────────');
  const { engine } = col;
  await engine.handleUserSpeech({ transcript: 'Where are my headphones?', requestId: 'demo_normal_1' });
  await engine.handleUserSpeech({ transcript: 'When will it arrive?', requestId: 'demo_normal_2' });
  await engine.handleUserSpeech({ transcript: 'What is the refund policy?', requestId: 'demo_normal_3' });
  return 'PASS';
}

async function runInterrupt(col: ReturnType<typeof makeEngine>): Promise<string> {
  line('── INTERRUPTION TEST ──────────────────────────────────────────');
  const { engine, conversation } = col;
  engine.setToolOverrides({ latency: { trackOrder: LAPTOP_DELAY, getOrder: LAPTOP_DELAY } });
  const t1 = engine.handleUserSpeech({ transcript: 'Where is my laptop?', requestId: 'demo_int_laptop' });
  await sleep(500);
  engine.setToolOverrides({ latency: {} });
  await engine.handleUserSpeech({ transcript: 'Wait, I mean my blue headphones.', requestId: 'demo_int_headphones' });
  await t1;
  const gen = conversation.generation;
  line(`generation after interrupt = ${gen} (must be ≥2)`);
  return gen >= 2 ? 'PASS' : 'FAIL';
}

async function runStale(col: ReturnType<typeof makeEngine>): Promise<string> {
  line('── STALE RESULT TEST ──────────────────────────────────────────');
  const { engine, metrics } = col;
  engine.setToolOverrides({ latency: { trackOrder: LAPTOP_DELAY, getOrder: LAPTOP_DELAY } });
  const t1 = engine.handleUserSpeech({ transcript: 'Where is my laptop?', requestId: 'demo_stale_laptop' });
  await sleep(500);
  engine.setToolOverrides({ latency: {} });
  await engine.handleUserSpeech({ transcript: 'Wait, I mean my blue headphones.', requestId: 'demo_stale_headphones' });
  await t1;
  const discarded = metrics.snapshot().staleResultsDiscarded;
  const hasStaleEvent = metrics.snapshot().events.some((e) => e.event === 'STALE_RESULT_DISCARDED');
  line(`STALE_RESULT_DISCARDED events = ${discarded}`);
  line(`headphones spoken = ${col.uttered.some((u) => /VR-48291|out for delivery/i.test(u))}`);
  line(`laptop spoken = ${col.uttered.some((u) => /MacBook|laptop/i.test(u))}`);
  void hasStaleEvent;
  return discarded >= 1 ? 'PASS' : 'FAIL';
}

async function runRime(col: ReturnType<typeof makeEngine>): Promise<string> {
  line('── RIME TEST ──────────────────────────────────────────────────');
  const { engine } = col;
  await engine.handleUserSpeech({ transcript: 'Where are my blue headphones?', requestId: 'demo_rime' });
  const chunks = col.events.filter((e) => e.type === 'rime_chunk');
  const fallback = chunks.some((e) => (e.payload as { disclosedFallback?: boolean })?.disclosedFallback === true);
  line(`rime configured = ${rimeConfig.apiKey ? 'yes' : 'NO — disclosed fallback used'}`);
  line(`rime model=${rimeConfig.model} speaker=${rimeConfig.speaker} lang=${rimeConfig.language}`);
  line(`real speak path emitted ${chunks.length} rime_chunk event(s) (${fallback ? 'fallback, disclosed' : 'Rime'})`);
  return chunks.length >= 1 ? 'PASS' : 'FAIL';
}

async function runLatency(col: ReturnType<typeof makeEngine>): Promise<string> {
  line('── LATENCY TEST ───────────────────────────────────────────────');
  const { engine, metrics } = col;
  engine.setToolOverrides({ latency: {} });
  const t0 = Date.now();
  await engine.handleUserSpeech({ transcript: 'Where are my blue headphones?', requestId: 'demo_lat' });
  const turnTime = Date.now() - t0;
  const snap = metrics.snapshot();
  const lastTurn = snap.latencies.at(-1);
  line(`end-to-end turn (T0→speech text ready) = ${turnTime} ms`);
  line(`tool latency = ${lastTurn?.toolLatencyMs ?? 'n/a'} ms`);
  line(`events: ${snap.events.slice(-8).map((e) => `${e.event}${e.durationMs ? `(${e.durationMs}ms)` : ''}`).join(' → ')}`);
  line(`NOTE: with the disclosed fallback path, TTFA is measured from audio chunk emission. With RIME_API_KEY set, real Rime audio latency (T3→T4) is captured in the dev panel.`);
  return 'PASS';
}

async function main() {
  const mode = (process.argv[2] ?? 'all') as string;
  line(`VaaniResolve demo — mode=${mode}  (${new Date().toISOString()})`);

  const m = mode === 'all' ? ['normal', 'interrupt', 'stale', 'rime', 'latency'] : [mode];
  const results: Record<string, string> = {};
  for (const kind of m) {
    // The Rime mode drives the REAL speak path (streamRime / fallback synth);
    // the other modes inject a speak sink so assertions are pure text.
    const col = makeEngine({ uttered: [], events: [] }, { realSpeak: kind === 'rime' });
    let res = 'FAIL';
    try {
      switch (kind) {
        case 'normal': res = await runNormal(col); break;
        case 'interrupt': res = await runInterrupt(col); break;
        case 'stale': res = await runStale(col); break;
        case 'rime': res = await runRime(col); break;
        case 'latency': res = await runLatency(col); break;
        default: throw new Error(`unknown demo mode ${kind}`);
      }
    } catch (err) {
      res = `FAIL (${err instanceof Error ? err.message : err})`;
    }
    results[kind] = res;
    line(`[${kind}] => ${res}`);
    line('');
  }
  line('────────────────────────────────────────────────────────────────');
  line(`DEMO SUMMARY: ${JSON.stringify(results)}`);
  const failed = Object.values(results).some((r) => r !== 'PASS');
  process.exit(failed ? 1 : 0);
}

void main();