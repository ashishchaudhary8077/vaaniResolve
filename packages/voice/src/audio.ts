/**
 * AudioPlaybackController (spec section 5).
 *
 * Owns the Web Audio graph. PCM is decoded to AudioBuffers and queued so Rime
 * audio can stream; `interrupt()` stops playback instantly, flushes the queue,
 * and cancels any in-flight decode/fetch generation.
 *
 * Only audio stamped with the CURRENT generation may be scheduled — an
 * obsolete generation arriving here is discarded (never spoken).
 */

export interface PlaybackItem {
  requestId: string;
  sessionId: string;
  turnId: number;
  generation: number;
  chunkIndex: number;
  sampleRate: number;
  audioBase64: string;
}

export interface AudioControllerCallbacks {
  onPlayingStart?: () => void;
  onPlayingEnd?: () => void;
  onGenerationDiscarded?: (generation: number, reason: string) => void;
  onError?: (err: Error) => void;
}

export class AudioPlaybackController {
  private ctx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private queue: PlaybackItem[] = [];
  private generation = 0;
  private playing = false;
  private startedAt = 0;
  /**
   * Moving start-time clock for gapless chunk playback. Each chunk starts
   * exactly when the previous one ends (CPU-clock accurate), so consecutive
   * PCM chunks play back-to-back with no audible join gap — without this,
   * the onended-chained pump introduces event-loop latency between every
   * chunk and speech sounds choppy.
   */
  private nextStartTime = 0;
  /**
   * Persistent output chain shared by every chunk. Rime PCM is decoded and
   * scheduled with the gapless clock, then passes through a voice-clarity chain
   * before reaching the speakers: a presence high-shelf (brighter highs on the
   * small laptop drivers that roll off), a modest loudness boost, and a soft
   * limiter so the boost can never clip. Nodes are created once against the
   * AudioContext and reused — the chain never interrupts gapless scheduling.
   */
  private outTail: AudioNode | null = null;

  constructor(private callbacks: AudioControllerCallbacks = {}) {}

  /**
   * Lazily build the clarity chain for the current AudioContext. Degrades
   * gracefully: if any node type is unsupported we fall back to a direct
   * connect, so clarity is additive and never breaks playback.
   */
  private ensureOutTail(ctx: AudioContext): AudioNode | null {
    if (this.outTail) return this.outTail;
    try {
      const highshelf = ctx.createBiquadFilter();
      highshelf.type = 'highshelf';
      highshelf.frequency.value = 2800;
      highshelf.gain.value = 4; // +4 dB presence — perception of "clearer" highs
      const loudness = ctx.createGain();
      loudness.gain.value = 1.5; // ~+3.5 dB — the Rime stream idles quiet on laptops
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.25;
      highshelf.connect(loudness).connect(limiter).connect(ctx.destination);
      this.outTail = highshelf; // sources connect into the chain head
    } catch {
      this.outTail = null; // unsupported — fall back to direct connect
    }
    return this.outTail;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    }
    return this.ctx;
  }

  /**
   * Unlock audio on a user gesture. Browsers suspend a fresh AudioContext that
   * is not created inside a user gesture — lazily creating it when the first
   * spoken chunk arrives (seconds after the mic tap) makes playback silently
   * fail. Call this from the FIRST pointer/keydown handler so the context is
   * created + resumed inside the gesture and audio "just works".
   */
  unlock(): void {
    try {
      const ctx = this.ensureCtx();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    } catch {
      /* audio unavailable — browser TTS fallback covers it */
    }
  }

  /** Set the current conversation generation. Any currently-playing source is
   *  stopped IMMEDIATELY and the queue is flushed so no obsolete-generation
   *  audio keeps sounding after a bump (even when the bump did not originate
   *  from a local interrupt). */
  setGeneration(gen: number): void {
    if (gen === this.generation) return;
    this.interrupt(); // stop current source + drain queue now
    this.nextStartTime = 0; // fresh sentence → fresh clock
    this.generation = gen;
  }

  get playingNow(): boolean {
    return this.playing;
  }

  private flushQueue(flushedGeneration?: number): void {
    while (this.queue.length) {
      const item = this.queue.shift()!;
      if (flushedGeneration !== undefined && item.generation !== flushedGeneration) continue;
      this.callbacks.onGenerationDiscarded?.(item.generation, 'generation changed');
    }
    this.queue = [];
  }

  /** Append a decoded PCM chunk to the playback queue. */
  enqueue(item: PlaybackItem): void {
    if (item.generation !== this.generation) {
      this.callbacks.onGenerationDiscarded?.(item.generation, 'obsolete generation — never spoken');
      return;
    }
    this.queue.push(item);
    void this.pump();
  }

  /** Stop everything NOW: abort current source, clear queue. */
  interrupt(): { stoppedAt: number } {
    return this.stop();
  }

  /** Alias of interrupt(); idempotent. */
  stop(): { stoppedAt: number } {
    const now = performance.now();
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this.flushQueue();
    this.nextStartTime = 0; // a stopped/short chats starts the clock over
    this.playing = false;
    return { stoppedAt: now };
  }

  pause(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Interrupt and drop everything, also locking out new audio until setGeneration. */
  hardClear(): void {
    this.interrupt();
    this.generation = -1;
  }

  private async pump(): Promise<void> {
    if (this.playing || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    if (item.generation !== this.generation) {
      this.callbacks.onGenerationDiscarded?.(item.generation, 'obsolete generation — never spoken');
      void this.pump();
      return;
    }
    this.playing = true;
    this.callbacks.onPlayingStart?.();
    try {
      const ctx = this.ensureCtx();
      await ctx.resume();
      // Still blocked by autoplay (no user gesture yet) — keep the item and try
      // again once the next chunk arrives or unlock() is called. Never drop it.
      if (ctx.state !== 'running') {
        this.playing = false;
        this.queue.unshift(item);
        return;
      }
      const buffer = pcmToAudioBuffer(ctx, item.audioBase64, item.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Voice-clarity chain (presence + loudness + limiter); plain direct
      // connect if the chain is unavailable on this browser.
      const tail = this.ensureOutTail(ctx);
      source.connect(tail ?? ctx.destination);
      this.currentSource = source;
      // Gapless scheduling. Start the first chunk almost-immediately, then each
      // subsequent chunk exactly when the previous one finishes (moving clock).
      // If we merely called source.start(), a fresh AudioContext render quantum
      // has no way to continue a previous buffer, so onended-chaining would put
      // an audible gap between every chunk. The clock makes joins sample-accurate.
      if (this.nextStartTime < ctx.currentTime) {
        this.nextStartTime = ctx.currentTime + 0.02; // ~20 ms safety before "now"
      }
      const startAt = this.nextStartTime;
      source.start(startAt);
      this.nextStartTime = startAt + buffer.duration;
      this.startedAt = performance.now();
      source.onended = () => {
        if (this.currentSource === source) this.currentSource = null;
        this.playing = false;
        this.callbacks.onPlayingEnd?.();
        if (this.queue.length) void this.pump();
      };
    } catch (err) {
      this.playing = false;
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      if (this.queue.length) void this.pump();
    }
  }
}

/**
 * Decode raw PCM s16le base64 (Rime rSpeech at `sampling_rate` and the
 * disclosed fallback both emit this) into a resampled AudioBuffer for playback.
 * @param sampleRate the PCM sample rate (e.g. 24000 for Rime).
 */
function pcmToAudioBuffer(ctx: AudioContext, b64: string, sampleRate: number): AudioBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const frames = int16.length;
  const buffer = ctx.createBuffer(1, frames, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) channel[i] = int16[i] / 32768;
  return buffer;
}