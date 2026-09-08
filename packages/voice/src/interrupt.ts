/**
 * InterruptController (spec sections 3 & 5).
 *
 * On a user interruption:
 *   1. stop current Rime audio immediately
 *   2. flush queued audio
 *   3. tell the server to increment generation (abort/invalidate prior work)
 *   4. new turn is routed fresh
 *
 * The "listen while it works" capability (USP) means the mic stays open during
 * tool execution/speech; when a valid user transcript arrives it triggers an
 * interrupt rather than being lost or queued behind stale work.
 */

export interface InterruptRequest {
  sessionId: string;
  turnId: number;
  generation: number;
}

export class InterruptController {
  constructor(private onInterrupt: (req: InterruptRequest) => void) {}

  handle(
    sessionId: string,
    current: { turnId: number; generation: number },
    source: 'speech' | 'stt' | 'barge-in' | 'manual',
  ): void {
    this.onInterrupt({ sessionId, turnId: current.turnId, generation: current.generation });
    void source;
  }
}