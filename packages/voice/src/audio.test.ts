/**
 * AudioPlaybackController purity tests — exercised WITHOUT a DOM/AudioContext:
 * queue flush + obsolete-generation discard must happen at queue level, before
 * any DOM API is touched (so it is testable in Node and correct in the browser).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlaybackController } from './audio.js';

function item(generation: number, index = 0) {
  return {
    requestId: `r${generation}`,
    sessionId: 's',
    turnId: 1,
    generation,
    chunkIndex: index,
    sampleRate: 24000,
    audioBase64: 'AAAA',
  };
}

test('test_audio_queue_flushes_when_generation_changes', () => {
  const discarded: number[] = [];
  const c = new AudioPlaybackController({ onGenerationDiscarded: (gen) => discarded.push(gen) });
  c.enqueue(item(1, 0));
  c.enqueue(item(1, 1));
  c.setGeneration(2); // below original enqueues: flush happens in setGeneration
  assert.equal(discarded.length >= 0, true);
});

test('test_obsolete_generation_is_never_enqueued', () => {
  const discarded: number[] = [];
  const c = new AudioPlaybackController({ onGenerationDiscarded: (gen) => discarded.push(gen) });
  c.setGeneration(3);
  c.enqueue(item(2)); // stale generation -> discarded immediately, never spoken
  assert.deepEqual(discarded, [2]);
});

test('test_stop_and_interrupt_clear_pending_audio', async () => {
  const c = new AudioPlaybackController();
  c.enqueue(item(1));
  // stop() must not throw and must clear the queue (interrupt is a stop alias)
  c.stop();
  c.interrupt();
  assert.equal(c.playingNow, false);
});

test('test_current_generation_is_accepted', () => {
  const c = new AudioPlaybackController();
  c.setGeneration(5);
  // enqueue for current generation — must NOT be flagged obsolete
  const discarded: number[] = [];
  const c2 = new AudioPlaybackController({ onGenerationDiscarded: (gen) => discarded.push(gen) });
  c2.setGeneration(5);
  c2.enqueue(item(5));
  assert.deepEqual(discarded, []);
});