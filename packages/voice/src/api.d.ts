/**
 * @vaaniresolve/voice — AUTHORITATIVE PUBLIC CONTRACT (declaration only).
 *
 * Pins: AudioPlaybackController (public shape) and InterruptController,
 * plus PlaybackItem, AudioControllerCallbacks, and InterruptRequest types.
 * Private members are excluded by Public<T> in conformance.ts.
 */

/* ------------------------------------------------------------ types */

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

/* Internal — used by InterruptController's constructor type but NOT exported
   by the barrel (matches the implementation). */
interface InterruptRequest {
  sessionId: string;
  turnId: number;
  generation: number;
}

/* ------------------------------------------------------------ classes */

export class AudioPlaybackController {
  constructor(callbacks?: AudioControllerCallbacks);
  unlock(): void;
  setGeneration(gen: number): void;
  get playingNow(): boolean;
  enqueue(item: PlaybackItem): void;
  interrupt(): { stoppedAt: number };
  stop(): { stoppedAt: number };
  pause(): void;
  resume(): Promise<void>;
  hardClear(): void;
}

export class InterruptController {
  constructor(onInterrupt: (req: InterruptRequest) => void);
  handle(
    sessionId: string,
    current: { turnId: number; generation: number },
    source: 'speech' | 'stt' | 'barge-in' | 'manual',
  ): void;
}