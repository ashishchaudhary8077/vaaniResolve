/**
 * Metrics + structured event log (spec section 11).
 * Latency is measured at real call sites with performance.now() — never fabricated.
 */

export type MetricEventName =
  | 'USER_SPEECH_START'
  | 'USER_SPEECH_END'
  | 'LLM_START'
  | 'TOOL_START'
  | 'TOOL_COMPLETE'
  | 'USER_INTERRUPT'
  | 'GENERATION_INVALIDATED'
  | 'RIME_START'
  | 'RIME_FIRST_AUDIO'
  | 'RIME_STOP'
  | 'STALE_RESULT_DISCARDED'
  | 'RESPONSE_COMPLETE'
  | 'ERROR';

export interface MetricEvent {
  ts: number;
  event: MetricEventName;
  sessionId: string;
  turnId: number;
  generation: number;
  requestId?: string;
  detail?: string;
  durationMs?: number;
}

export interface TurnLatency {
  /** T0: user stopped speaking */
  t0?: number;
  /** T1: usable STT */
  tStt?: number;
  /** T2: useful LLM response */
  tLlm?: number;
  /** T3: Rime request */
  tRimeReq?: number;
  /** T4: first Rime audio produced */
  tRimeFirst?: number;
  /** T5: first audible playback (server approximates as first audio pkt sent) */
  tAudible?: number;
  /** TTFA = T5 - T0 */
  ttfaMs?: number;
  sttMs?: number;
  llmMs?: number;
  rimeRequestMs?: number;
  rimeFirstAudioMs?: number;
  toolLatencyMs?: number;
  interruptionToAudioStopMs?: number;
}

export class Metrics {
  events: MetricEvent[] = [];
  latencies: TurnLatency[] = [];
  interruptCount = 0;
  cancelledRequests = 0;
  staleResultsDiscarded = 0;
  generationBumps = 0;
  private lastInterruptStopNoted = 0;

  log(e: Omit<MetricEvent, 'ts'>): MetricEvent {
    const ev: MetricEvent = { ...e, ts: Date.now() };
    this.events.push(ev);
    if (ev.event === 'USER_INTERRUPT') this.interruptCount++;
    if (ev.event === 'GENERATION_INVALIDATED') this.generationBumps++;
    if (ev.event === 'STALE_RESULT_DISCARDED') this.staleResultsDiscarded++;
    if (ev.event === 'ERROR') this.cancelledRequests++;
    return ev;
  }

  noteInterruptionToAudioStop(ms: number): void {
    this.lastInterruptStopNoted = ms;
  }

  commitTurn(l: TurnLatency): void {
    if (l.tAudible && l.t0) l.ttfaMs = Math.round(l.tAudible - l.t0);
    this.latencies.push(l);
  }

  snapshot() {
    const last = this.latencies[this.latencies.length - 1];
    return {
      events: this.events.slice(-400),
      latencies: this.latencies.slice(-40),
      interruptCount: this.interruptCount,
      cancelledRequests: this.cancelledRequests,
      staleResultsDiscarded: this.staleResultsDiscarded,
      generationBumps: this.generationBumps,
      lastTtfaMs: last?.ttfaMs,
      lastInterruptionToAudioStopMs: this.lastInterruptStopNoted,
    };
  }
}