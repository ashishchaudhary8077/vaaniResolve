import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseSseChunk, synthFallback } from './stream.js';
import { formatSpeechFromTool, formatOrderForSpeech } from './format.js';

const cfg = { apiKey: 'secret-key', endpoint: 'https://users.rime.ai/v1/rSpeech', model: 'rime-tts', speaker: 'astra', language: 'en', sampleRate: 24000 };

test('buildRequest includes Rime auth + PCM stream options', () => {
  const { headers, body } = buildRequest(cfg, { text: 'Hello' }, true);
  assert.equal(headers.Authorization, 'Bearer secret-key');
  assert.equal(headers.Accept, 'text/event-stream');
  const parsed = JSON.parse(body);
  assert.equal(parsed.model, 'rime-tts');
  assert.equal(parsed.speaker, 'astra');
  assert.equal(parsed.stream, true);
  assert.equal(parsed.sampling_rate, 24000);
});

test('parseSseChunk handles audio, text and done', () => {
  const audio = parseSseChunk('data: {"type":"audio","data":"AAAA"}');
  assert.equal(audio?.audioBase64, 'AAAA');
  const text = parseSseChunk('data: {"type":"text","data":"hel"}');
  assert.equal(text?.text, 'hel');
  assert.equal(parseSseChunk('data: [DONE]')?.done, true);
  assert.equal(parseSseChunk('')?.done, undefined);
});

test('fallback synth is disclosed, valid PCM, deterministic length', () => {
  const a = synthFallback('Your order is out for delivery');
  assert.equal(a.disclosed, true);
  // User-safe disclosed reason (no raw technical detail — Requirement: friendly
  // errors in the UI; the technical cause stays in server logs only).
  assert.match(a.reason, /Rime is unavailable/);
  assert.ok(!/HTTP|status|error kind/i.test(a.reason), 'reason must not leak internal error detail');
  const bytes = Buffer.from(a.audioBase64, 'base64');
  assert.ok(bytes.length % 2 === 0, 'PCM s16le must be even byte-aligned');
  assert.ok(a.rateHz > 0);
  // deterministic
  const b = synthFallback('Your order is out for delivery');
  assert.equal(a.audioBase64, b.audioBase64);
});

test('speech formatter keeps spoken answers terse', () => {
  const o = {
    orderId: 'VR-48291', status: 'OUT_FOR_DELIVERY', expectedDelivery: 'Today',
    items: [{ name: 'Sony WH-1000XM5 Headphones' }], total: 299,
  } as never;
  const s = formatOrderForSpeech(o);
  assert.match(s, /Sony WH-1000XM5 Headphones/);
  assert.match(s, /out for delivery/);
  assert.ok(!s.includes('#'), 'speech must not contain markdown');

  const r = {
    requestId: 'r1', sessionId: 's', turnId: 1, generation: 1, tool: 'getOrder', ok: true, latencyMs: 5, data: o,
  } as never;
  assert.match(formatSpeechFromTool('getOrder', r), /out for delivery/);
});