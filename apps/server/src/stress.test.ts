/**
 * REQUIRED STRESS TEST (spec section 13) — deterministic, engine-level.
 *
 * 1. User asks "Where is my laptop?"
 * 2. Laptop lookup is delayed (toolOverrides latency ~4s).
 * 3. AI begins replying (injected speak records it).
 * 4. User says "Wait, I mean my blue headphones."
 * 5. Generation bumps, previous Rime work is invalidated.
 * 6. The delayed laptop tool eventually returns.
 * 7. Laptop result is rejected as STALE.
 * 8. Headphone request executes fully.
 * 9. ONLY the headphone result is spoken.
 * 10. Metrics emit STALE_RESULT_DISCARDED.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationManager } from '@vaaniresolve/state';
import { Agent } from '@vaaniresolve/agent';
import type { RimeConfig } from '@vaaniresolve/rime';
import { ConversationEngine, type EngineSpeak } from './engine.js';
import { Metrics } from './metrics.js';

const LAPTOP_DELAY_MS = Number(process.env.STRESS_LAPTOP_MS ?? 4000);

function makeRimeConfig(): RimeConfig {
  return { apiKey: '', endpoint: 'https://users.rime.ai/v1/rSpeech', model: 'rime-tts', speaker: 'astra', language: 'en', sampleRate: 24000 };
}

function makeEngine(speakLog: string[]): { engine: ConversationEngine; metrics: Metrics; conversation: ConversationManager } {
  const conversation = new ConversationManager('stress_session');
  const metrics = new Metrics();
  const agent = new Agent('', 'claude-sonnet-5-1'); // deterministic fallback (no key)
  const spoken: EngineSpeak = async (utterance) => {
    speakLog.push(utterance.text);
  };
  const engine = new ConversationEngine({
    conversation,
    agent,
    rimeConfig: makeRimeConfig(),
    metrics,
    // seed 7000: first PRNG draw (0.055) exceeds cancelOrder's 5% failureRate, so
    // the confirmed destructive execution succeeds deterministically (seed 1's
    // first draw is ~0.000008 — it would always fail with a "transient error").
    toolOverrides: { seed: 7000, latency: { getOrder: LAPTOP_DELAY_MS, trackOrder: LAPTOP_DELAY_MS } },
    speak: spoken,
    events: { send: () => undefined },
  });
  return { engine, metrics, conversation };
}

/** Small deterministic sleep. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fast(engine: ConversationEngine): void {
  engine.setToolOverrides({ latency: {} });
}

test('stress: interruption during tool execution → stale laptop result never spoken, headphones only', { timeout: 30000 }, async () => {
  const speakLog: string[] = [];
  const { engine, metrics, conversation } = makeEngine(speakLog);

  // Fire the "laptop" turn — DO NOT await; it is delayed by the slow tool.
  const laptopTurn = engine.handleUserSpeech({ transcript: 'Where is my laptop?', requestId: 'r_laptop' });
  assert.equal(conversation.generation, 1);

  // Let the laptop tool start, then interrupt with the corrected entity.
  await sleep(400);
  fast(engine); // the corrected request must run at normal latency
  await engine.handleUserSpeech({ transcript: 'Wait, I mean my blue headphones.', requestId: 'r_headphones' });

  assert.equal(conversation.generation, 2, 'interrupt must bump generation');
  // The corrected turn must run to a valid terminal state (RESOLVED), not an error.
  assert.ok(['RESOLVED', 'IDLE'].includes(conversation.state), `state after corrected turn: ${conversation.state}`);

  // Headphone request completes (~1.6s) → only headphones spoken.
  await sleep(3000);
  // The laptop turn must have resolved (stale) without having spoken laptop text.
  await laptopTurn;

  const spoken = speakLog.join(' || ');
  assert.ok(!/MacBook|laptop/i.test(spoken), `laptop result must NOT be spoken. spoke: "${spoken}"`);
  assert.ok(/Sony WH-1000XM5|order VR-48291|out for delivery/i.test(spoken), `headphone result must be spoken. spoke: "${spoken}"`);

  const snap = metrics.snapshot();
  const staleEvents = snap.events.filter((e) => e.event === 'STALE_RESULT_DISCARDED');
  assert.ok(staleEvents.length >= 1, `expected STALE_RESULT_DISCARDED, got events: ${snap.events.map((e) => e.event).join(',')}`);
  assert.ok(snap.events.some((e) => e.event === 'USER_INTERRUPT'), 'expected USER_INTERRUPT');
  assert.ok(snap.staleResultsDiscarded >= 1);
});

test('stress: new request wins — headphones reference re-resolves correct order (VR-48291)', { timeout: 30000 }, async () => {
  const speakLog: string[] = [];
  const { engine, conversation } = makeEngine(speakLog);
  const t1 = engine.handleUserSpeech({ requestId: 'r1', transcript: 'Where is my laptop?' });
  await sleep(350);
  fast(engine);
  await engine.handleUserSpeech({ requestId: 'r2', transcript: 'Wait, I mean my blue headphones.' });
  await sleep(3000);
  await t1;

  const lastSpoken = speakLog.join(' || ');
  assert.ok(/VR-48291|out for delivery/i.test(lastSpoken), `expected VR-48291 (headphones), got: ${lastSpoken}`);
  assert.ok(!/VR-11360|MacBook/i.test(lastSpoken), 'laptop order must not be the final answer');
});

test('stress: context preserved across interruption', { timeout: 30000 }, async () => {
  const { engine, conversation } = makeEngine([]);
  await engine.handleUserSpeech({ requestId: 'r1', transcript: 'Where is my laptop?' });
  await sleep(400);
  fast(engine);
  await engine.handleUserSpeech({ requestId: 'r2', transcript: 'Wait, I mean my blue headphones.' });
  await sleep(3000);
  const activeOrder = conversation.getEntity('activeOrder') as { orderId?: string } | undefined;
  assert.equal(activeOrder?.orderId, 'VR-48291', 'active order must reflect the corrected headphones entity');
});

test('stress: confirmation cannot execute after a changed mind', { timeout: 30000 }, async () => {
  const speakLog: string[] = [];
  const { engine, conversation } = makeEngine(speakLog);
  // Start a destructive request → confirmation required.
  await engine.handleUserSpeech({ requestId: 'r1', transcript: 'Cancel my blue headphones.' });
  const pending = conversation.getPendingAction();
  assert.ok(pending, 'expected a pending destructive action awaiting confirmation');
  // User changes their mind mid-confirmation.
  await engine.handleUserSpeech({ requestId: 'r2', transcript: "Actually don't cancel them." });
  assert.equal(conversation.getPendingAction(), undefined, 'pending action cancelled after changed mind');
  await sleep(1500);
  const spoken = speakLog.join(' || ');
  assert.ok(/no problem|cancelled that|nothing has been changed/i.test(spoken), `expected cancellation-of-cancellation speech, got: ${spoken}`);
});

test('stress: voice confirmation "yes, go ahead" executes the destructive tool', { timeout: 30000 }, async () => {
  const speakLog: string[] = [];
  const { engine, conversation } = makeEngine(speakLog);
  await engine.handleUserSpeech({ requestId: 'r1', transcript: 'Cancel my laptop order.' });
  assert.ok(conversation.getPendingAction(), 'expected pending destructive action');
  // Voice accept must route to handleConfirmation (not the generic agent).
  await engine.handleUserSpeech({ requestId: 'r2', transcript: 'yes, go ahead' });
  assert.equal(conversation.getPendingAction(), undefined, 'pending cleared after accept');
  await sleep(2500);
  const spoken = speakLog.join(' || ');
  assert.ok(/has been cancelled|VR-11360/i.test(spoken), `expected cancellation executed, got: "${spoken}"`);
  assert.ok(!/can no longer|not eligible/i.test(spoken), 'execution must not be rejected');
});

test('stress: voice "no, do not" declines without mutating anything', { timeout: 30000 }, async () => {
  const speakLog: string[] = [];
  const { engine, conversation } = makeEngine(speakLog);
  await engine.handleUserSpeech({ requestId: 'r1', transcript: 'Cancel my laptop order.' });
  assert.ok(conversation.getPendingAction(), 'expected pending action');
  await engine.handleUserSpeech({ requestId: 'r2', transcript: "no, don't cancel" });
  assert.equal(conversation.getPendingAction(), undefined, 'pending cleared after decline');
  await sleep(1500);
  const spoken = speakLog.join(' || ');
  assert.ok(/no problem|cancelled that|nothing has been changed/i.test(spoken), `decline speech expected, got: "${spoken}"`);
  assert.ok(!/has been cancelled/i.test(spoken), 'destructive action must NOT have executed');
});

test('stress: tool timeout produces a graceful error, never a hang', { timeout: 50000 }, async () => {
  const speakLog: string[] = [];
  const { engine } = makeEngine(speakLog);
  engine.setToolOverrides({ latency: { getOrders: 60_000 }, timeout: 1200 });
  const started = Date.now();
  await engine.handleUserSpeech({ requestId: 'r1', transcript: 'Show me my orders.' });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 30_000, 'tool must time out instead of hanging forever');
  const spoken = speakLog.join(' || ');
  assert.ok(/could not complete|couldn't|try again/i.test(spoken), `expected graceful error speech, got: ${spoken}`);
});