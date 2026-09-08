/**
 * ConversationEngine — the orchestration loop (spec sections 3, 4, 5).
 *
 *  User speech → LLM/Agent decide → tool router → speak via Rime → client.
 *
 * Stale-result protection lives here and in the tool stamps:
 *   • A user interruption (or a new user turn while something is still in
 *     flight) bumps `generation`.
 *   • Every async op captures its generation at start.
 *   • When async work later completes, its stamped generation is compared to
 *     `conversation.generation`. Mismatch ⇒ STALE_RESULT_DISCARDED, never spoken.
 *   • Rime speech is aborted on interrupt; queued audio is flushed client-side.
 *
 *  INVARIANT (enforced here): NO OBSOLETE GENERATION MAY EVER BE SPOKEN.
 */

import { ConversationManager } from '@vaaniresolve/state';
import type { Agent, AgentDecision } from '@vaaniresolve/agent';
import type { ToolOverrides } from '@vaaniresolve/tools';
import { executeTool } from '@vaaniresolve/tools';
import type { RimeConfig, SpeechUtterance } from '@vaaniresolve/rime';
import { streamRime, synthFallback, formatSpeechFromTool, confirmationSummaryFromArgs, formatTrackResult, speakInr } from '@vaaniresolve/rime';
import type { WireMessage, SessionContext, ConfirmationAnswer, ResolutionCard } from '@vaaniresolve/shared';
import { Metrics } from './metrics.js';

export interface EngineEvents {
  send: (msg: WireMessage) => void;
  onSpeakWrap?: (fn: EngineSpeak) => EngineSpeak;
}

export type EngineSpeak = (utterance: SpeechUtterance, ctx: SessionContext) => Promise<void>;

export interface EngineOptions {
  conversation: ConversationManager;
  agent: Agent;
  rimeConfig: RimeConfig;
  metrics: Metrics;
  events: EngineEvents;
  toolOverrides?: ToolOverrides;
  /** injected speak (tests capture chunks without a socket) */
  speak?: EngineSpeak;
}

interface InFlight {
  abort: AbortController;
  turnId: number;
  generation: number;
  label: string;
}

export function baseContext(c: ConversationManager, requestId: string): SessionContext {
  return { sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, requestId };
}

export class ConversationEngine {
  private inflight: InFlight | null = null;
  private metrics: Metrics;

  constructor(private opts: EngineOptions) {
    this.metrics = this.opts.metrics;
  }

  get conversation(): ConversationManager {
    return this.opts.conversation;
  }

  /** Swap tool-latency/failure overrides at runtime (demo + stress harness). */
  setToolOverrides(o: ToolOverrides): void {
    this.opts.toolOverrides = o;
  }

  private send(msg: Omit<WireMessage, 'ts'>): void {
    this.opts.events.send({ ...msg, ts: Date.now() });
  }

  private ctx(requestId: string): SessionContext {
    return baseContext(this.conversation, requestId);
  }

  /* ------------------------------------------------------------- helpers */

  private cancelInflight(reason: string): void {
    if (this.inflight) {
      this.inflight.abort.abort();
      const { turnId, generation } = this.inflight;
      this.metrics.log({ event: 'GENERATION_INVALIDATED', sessionId: this.conversation.sessionId, turnId, generation, detail: reason });
      this.send({ type: 'generation_invalidated', sessionId: this.conversation.sessionId, turnId, generation, requestId: '', payload: { reason } });
      this.inflight = null;
    }
  }

  /**
   * Stop currently-streaming TTS WITHOUT bumping generation — used when a user
   * voice-answers a pending confirmation mid-question. A gen bump would clear
   * the pending action we are about to consume; a bare Rime stop + queue flush
   * cuts the question audio without marking anything stale.
   */
  private abortCurrentSpeech(): void {
    const s = this.inflight;
    if (s?.label === 'speech') {
      this.inflight = null;
      s.abort.abort();
      this.metrics.log({ event: 'RIME_STOP', sessionId: this.conversation.sessionId, turnId: s.turnId, generation: s.generation, detail: 'confirmation answered mid-speech' });
      this.send({ type: 'rime_stop', sessionId: this.conversation.sessionId, turnId: s.turnId, generation: s.generation, requestId: '' });
    }
  }

  private currentGen = () => this.conversation.generation;

  /**
   * Full interrupt path. Called when the user speaks again or presses STOP while
   * the server is active. Bumps generation → abort speech/tool → clear pending
   * action → the next turn runs fresh and any late result is stale.
   */
  interrupt(): { turnId: number; generation: number } {
    const c = this.conversation;
    const wasActive = this.inflight !== null || c.getState() === 'SPEAKING';
    const prevGen = c.generation;
    const { turnId, generation } = c.interrupt();
    this.cancelInflight(`interrupted during ${this.inflight?.label ?? 'speech'}`);
    c.resumeFromInterrupt();
    this.metrics.log({ event: 'USER_INTERRUPT', sessionId: c.sessionId, turnId, generation: prevGen, detail: `generation ${prevGen} -> ${generation}, active=${wasActive}` });
    this.send({ type: 'generation_bump', sessionId: c.sessionId, turnId, generation, requestId: '', payload: { prevGeneration: prevGen } });
    this.send({
      type: 'state_change',
      sessionId: c.sessionId,
      turnId,
      generation,
      requestId: '',
      payload: { state: 'INTERRUPTED' },
    });
    c.setState('IDLE');
    return { turnId, generation };
  }

  /* ------------------------------------------------------------- speak */

  private async speak(utterance: SpeechUtterance, requestContext: SessionContext): Promise<void> {
    if (this.opts.speak) {
      await this.opts.speak(utterance, requestContext);
      return;
    }
    const c = this.conversation;
    const gen = this.currentGen();
    const turnId = c.turnId;
    const sessionId = c.sessionId;
    const t0 = Date.now();
    this.sentFirstAudio = false;
    c.setState('SPEAKING');
    this.send({ type: 'state_change', sessionId, turnId, generation: gen, requestId: requestContext.requestId, payload: { state: 'SPEAKING', utterance: utterance.text } });

    const abort = new AbortController();
    const encCtx: SessionContext = { sessionId, turnId, generation: gen, requestId: requestContext.requestId };

    // Register as in-flight so a barge-in during SPEAKING aborts Rime directly
    // (previously inflight is null post-tool, so Rime kept streaming the stale
    // utterance). interrupt() → cancelInflight() now cuts TTS immediately.
    this.inflight = { abort, turnId, generation: gen, label: 'speech' };
    const release = () => { if (this.inflight?.abort === abort) this.inflight = null; };

    this.metrics.log({ event: 'RIME_START', sessionId, turnId, generation: gen, requestId: requestContext.requestId });
    if (this.opts.rimeConfig.apiKey) {
      try {
        const rimeHandle = await streamRime(
          this.opts.rimeConfig,
          utterance,
          (chunk) => {
            if (abort.signal.aborted) return;
            if (chunk.audioBase64) {
              if (!this.sentFirstAudio) {
                this.sentFirstAudio = true;
                const dt = Date.now() - t0;
                this.metrics.log({ event: 'RIME_FIRST_AUDIO', sessionId, turnId, generation: gen, durationMs: dt });
                this.send({ type: 'rime_first_audio', ...encCtx, payload: { t4: Date.now(), ttfaMs: dt } });
              }
              // Use the sample rate the Rime stream actually decoded at (WAV
              // header) when available, falling back to the configured rate.
              const sampleRate = chunk.sampleRate ?? this.opts.rimeConfig.sampleRate;
              this.send({ type: 'rime_chunk', ...encCtx, payload: { sampleRate, audioBase64: chunk.audioBase64, generation: gen } });
            }
            if (chunk.text) {
              this.send({ type: 'rime_chunk', ...encCtx, payload: { text: chunk.text } });
            }
          },
          { signal: abort.signal },
        );
        await rimeHandle.done();
        // Interrupted (abort fired) → the client already flushed this generation's
        // audio; do not emit rime_stop/speech_finished for an obsolete utterance.
        if (abort.signal.aborted) return;
        this.metrics.log({ event: 'RIME_STOP', sessionId, turnId, generation: gen });
        this.send({ type: 'rime_stop', ...encCtx });
        this.send({ type: 'speech_finished', ...encCtx });
      } catch (err) {
        // An interruption-triggered abort is NOT a TTS failure — stay silent.
        if (abort.signal.aborted) return;
        // Server-side only — never surfaced verbatim to the user UI.
        console.error(`[rime] stream failed (gen ${gen}): ${err instanceof Error ? err.message : String(err)}`);
        this.onRimeFailure(utterance, encCtx, err);
      } finally {
        release();
      }
    } else {
      this.onRimeFailure(utterance, encCtx, null, false);
      release();
    }
  }

  private sentFirstAudio = false;

  private onRimeFailure(utterance: SpeechUtterance, ctx: SessionContext, err: unknown, logError = true): void {
    if (logError) {
      this.metrics.log({ event: 'ERROR', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: ctx.requestId, detail: `Rime error: ${err instanceof Error ? err.message : String(err)}` });
    }
    // Disclosed fallback (resilience only) — attempt server-side synth so the
    // pipeline stays audible when Rime is absent/failing. Client discloses it.
    const fallback = synthFallback(utterance.text);
    this.metrics.log({ event: 'RIME_FIRST_AUDIO', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: ctx.requestId, detail: 'FALLBACK_TTS (disclosed): ' + fallback.reason });

    this.send({ type: 'rime_chunk', ...ctx, payload: { sampleRate: fallback.rateHz, audioBase64: fallback.audioBase64, generation: ctx.generation, disclosedFallback: true, reason: fallback.reason } });
    this.send({ type: 'rime_first_audio', ...ctx, payload: { disclosedFallback: true, reason: fallback.reason } });
    this.metrics.log({ event: 'RIME_STOP', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation });
    this.send({ type: 'rime_stop', ...ctx });
    this.send({ type: 'speech_finished', ...ctx });
  }

  /* ------------------------------------------------------------- turns */

  /**
   * Handle a user speech segment. Interrupts any active work first.
   */
  async handleUserSpeech(input: { transcript: string; speechEndedAt?: number; requestId?: string }): Promise<void> {
    const c = this.conversation;
    const reqId = input.requestId ?? c.newRequestId();

    // Voice answer to a pending destructive-action confirmation. Route yes/no
    // directly to handleConfirmation so "yes, go ahead" actually executes and
    // "no, don't cancel" declines — matching the button + spoken hints. This
    // runs before the interrupt block: WAITING_CONFIRMATION is a settled state,
    // not an active turn, so nothing needs a generation bump. If the model is
    // still asking the question, cut that speech (no gen bump — the pending
    // action must survive so it can be answered).
    if (c.getState() === 'WAITING_CONFIRMATION' && c.getPendingAction()) {
      const cleaned = input.transcript.trim().toLowerCase();
      const yes = /^(yes|yeah|yep|yup|sure(?:,\s*sure)?|ok(?:ay)?|go ahead|confirm|do it|please do)\b/.test(cleaned) || /^yes\b/.test(cleaned);
      const no = /^(no|nope|nah|don'?t|do not|cancel|stop|actually no|never mind)\b/.test(cleaned);
      if (yes || no) {
        const pending = c.getPendingAction()!;
        this.abortCurrentSpeech();
        c.pushUser(input.transcript);
        this.metrics.log({ event: 'USER_SPEECH_END', sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, requestId: reqId, detail: `confirmation answer: ${yes ? 'accept' : 'decline'}` });
        await this.handleConfirmation({ confirmationId: pending.confirmationId, accepted: yes });
        return;
      }
    }

    const active = this.inflight !== null || c.getState() === 'SPEAKING' || c.getState() === 'PROCESSING' || c.getState() === 'TOOL_RUNNING';

    this.metrics.log({ event: 'USER_SPEECH_START', sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, requestId: reqId, detail: input.transcript.slice(0, 120) });

    // THE interruption moment: speaking again while we are working.
    if (active) {
      this.interrupt();
    }

    const t0 = input.speechEndedAt ?? Date.now();
    const turnInfo = { turnId: c.turnId, generation: c.generation };
    c.setState('PROCESSING');
    c.pushUser(input.transcript);

    this.send({ type: 'state_change', sessionId: c.sessionId, turnId: turnInfo.turnId, generation: turnInfo.generation, requestId: reqId, payload: { state: 'PROCESSING' } });

    const abort = new AbortController();
    this.inflight = { abort, ...turnInfo, label: 'llm+tool' };

    const sessionId = c.sessionId;
    const generationAtStart = turnInfo.generation;
    const turnId = turnInfo.turnId;

    try {
      // LLM/agent decide (structured tool calling / deterministic fallback).
      const llmT0 = Date.now();
      this.metrics.log({ event: 'LLM_START', sessionId, turnId, generation: generationAtStart, requestId: reqId });
      const decision = await this.opts.agent.decide({ conversation: c }, input.transcript);
      this.metrics.commitTurn({ llmMs: Date.now() - llmT0 });

      if (!this.stillCurrent(sessionId, turnId, generationAtStart)) {
        this.metrics.log({ event: 'STALE_RESULT_DISCARDED', sessionId, turnId, generation: generationAtStart, requestId: reqId, detail: 'LLM decision arrived after interruption' });
        this.send({ type: 'stale_result_discarded', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { stage: 'llm' } });
        return;
      }
      this.metrics.log({ event: 'RESPONSE_COMPLETE', sessionId, turnId, generation: generationAtStart, requestId: reqId, detail: `LLM decision: ${decision.intent}` });
      this.send({ type: 'assistant_text', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { text: decision.speech } });

      if (decision.needsConfirmation) {
        await this.beginConfirmation(decision, reqId);
        return;
      }

      if (decision.tool) {
        await this.runToolAndSpeak(decision, reqId);
        return;
      }

      // Pure speech decision.
      if (decision.speech) {
        await this.speak({ text: decision.speech }, { sessionId, turnId, generation: generationAtStart, requestId: reqId });
        // The turn may have been interrupted while speaking — a newer turn owns state now.
        if (!this.stillCurrent(sessionId, turnId, generationAtStart)) return;
      }
      c.setState(c.getEntity('activeOrder') ? 'RESOLVED' : 'IDLE');
    } catch (err) {
      this.onError(err, { sessionId, turnId, generation: generationAtStart, requestId: reqId });
    } finally {
      if (this.inflight?.abort === abort) this.inflight = null;
    }
  }

  private async beginConfirmation(decision: AgentDecision, reqId: string): Promise<void> {
    const c = this.conversation;
    const sessionId = c.sessionId;
    const turnId = c.turnId;
    const generation = c.generation;
    const confirmationId = `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const summary = decision.confirmSummary ?? confirmationSummaryFromArgs(decision.tool ?? '', decision.args ?? {});

    c.setPendingAction({ tool: decision.tool ?? '', args: decision.args ?? {}, summary, confirmationId });
    c.setState('WAITING_CONFIRMATION');

    this.send({
      type: 'confirmation_required',
      sessionId,
      turnId,
      generation,
      requestId: reqId,
      payload: { action: decision.intent, tool: decision.tool, args: decision.args, summary, confirmationId },
    });

    await this.speak({ text: summary }, { sessionId, turnId, generation, requestId: reqId });
    this.metrics.log({ event: 'LLM_START', sessionId, turnId, generation, requestId: reqId, detail: 'confirmation asked' });
  }

  private async runToolAndSpeak(decision: AgentDecision, reqId: string): Promise<void> {
    const c = this.conversation;
    const sessionId = c.sessionId;
    const turnId = c.turnId;
    const generationAtStart = c.generation;

    c.setState('TOOL_RUNNING');
    this.send({ type: 'state_change', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { state: 'TOOL_RUNNING', tool: decision.tool } });
    this.send({ type: 'tool_start', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { tool: decision.tool ?? '', status: 'start' } });

    this.metrics.log({ event: 'TOOL_START', sessionId, turnId, generation: generationAtStart, requestId: reqId, detail: decision.tool ?? '' });

    const toolResult = await executeTool(
      decision.tool ?? '',
      decision.args ?? {},
      { sessionId, turnId, generation: generationAtStart, requestId: reqId },
      { overrides: this.opts.toolOverrides },
    );

    // STALE? — the tool's stamped generation is compared to the CURRENT one.
    if (!this.stillCurrent(sessionId, turnId, generationAtStart)) {
      this.metrics.log({ event: 'STALE_RESULT_DISCARDED', sessionId, turnId, generation: generationAtStart, requestId: reqId, detail: `tool ${decision.tool} returned after interruption` });
      this.send({ type: 'tool_stale', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { tool: decision.tool ?? '', status: 'stale' } });
      this.send({ type: 'stale_result_discarded', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { stage: 'tool', tool: decision.tool } });
      return;
    }

    this.metrics.log({ event: 'TOOL_COMPLETE', sessionId, turnId, generation: generationAtStart, requestId: reqId, durationMs: toolResult.latencyMs, detail: decision.tool ?? '' });
    this.metrics.commitTurn({ toolLatencyMs: toolResult.latencyMs });

    // Keep conversational context on resolved entities.
    if (toolResult.ok && toolResult.data && typeof toolResult.data === 'object') {
      const d = toolResult.data as Record<string, unknown>;
      if ('orderId' in d) {
        c.setEntity('activeOrder', toolResult.data as never);
      }
    }
    if (toolResult.ok && decision.tool === 'getProduct') {
      c.setEntity('activeProduct', toolResult.data as never);
    }

    const speech = formatSpeechFromTool(decision.tool ?? '', toolResult);
    const cards = extractCards(decision.tool ?? '', toolResult);

    this.send({ type: 'assistant_text', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { text: speech } });
    if (cards) {
      for (const card of cards) {
        this.send({ type: 'resolution', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: card });
      }
    }

    await this.speak({ text: speech, cards: cards ?? undefined }, { sessionId, turnId, generation: generationAtStart, requestId: reqId });

    // The turn may have been interrupted mid-speech — a newer turn owns state now.
    if (!this.stillCurrent(sessionId, turnId, generationAtStart)) return;

    c.setState('RESOLVED');
    this.send({ type: 'state_change', sessionId, turnId, generation: generationAtStart, requestId: reqId, payload: { state: 'RESOLVED' } });
    this.metrics.log({ event: 'RESPONSE_COMPLETE', sessionId, turnId, generation: generationAtStart, requestId: reqId, durationMs: toolResult.latencyMs });
  }

  /** Handle a confirmation answer (accept = execute pending destructive action). */
  async handleConfirmation(answer: ConfirmationAnswer): Promise<void> {
    const c = this.conversation;
    const pending = c.getPendingAction();
    if (!pending || pending.confirmationId !== answer.confirmationId) {
      this.send({ type: 'error', sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, requestId: c.newRequestId(), payload: { code: 'NO_PENDING', message: 'No pending action matches that confirmation.' } });
      return;
    }
    const reqId = c.newRequestId();
    if (!answer.accepted) {
      c.clearPendingAction();
      const text = 'No problem — I have cancelled that. Nothing on your account has been changed.';
      c.pushAssistant(text);
      const sid = c.sessionId, tid = c.turnId, gen = c.generation;
      await this.speak({ text }, { sessionId: sid, turnId: tid, generation: gen, requestId: reqId });
      if (!this.stillCurrent(sid, tid, gen)) return;
      c.setState('RESOLVED');
      return;
    }

    c.clearPendingAction();
    await this.runToolAndSpeak({ kind: 'deterministic', tool: pending.tool, args: pending.args, intent: 'confirmed_action', speech: '' }, reqId);
  }

  private stillCurrent(sessionId: string, turnId: number, generation: number): boolean {
    const c = this.conversation;
    if (sessionId !== c.sessionId) return false;
    if (turnId !== c.turnId) return false;
    if (generation !== c.generation) {
      this.metrics.log({ event: 'GENERATION_INVALIDATED', sessionId, turnId, generation, detail: 'generation changed before apply' });
      return false;
    }
    return true;
  }

  private onError(err: unknown, ctx: SessionContext): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.metrics.log({ event: 'ERROR', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: ctx.requestId, detail: msg });
    this.conversation.setState('ERROR');
    this.send({ type: 'error', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: ctx.requestId, payload: { code: 'ENGINE', message: msg } });
    this.conversation.setState('IDLE');
  }

  snapshot(): ReturnType<Metrics['snapshot']> {
    return this.metrics.snapshot();
  }
}

function extractCards(tool: string, result: { ok: boolean; data?: unknown }): ResolutionCard[] | null {
  if (!result.ok || !result.data) return null;
  const d = result.data as Record<string, unknown>;
  switch (tool) {
    case 'getOrder':
    case 'trackOrder':
    case 'getDeliveryEstimate': {
      const o = result.data as { orderId: string; status: string; expectedDelivery?: string; items?: { name: string }[] };
      return [
        {
          kind: 'order',
          title: `#${o.orderId}`,
          subtitle: (o.items?.[0]?.name as string) ?? '',
          status: o.status.replace(/_/g, ' '),
          details: { expected: o.expectedDelivery ?? '—', status: o.status },
        },
      ];
    }
    case 'cancelOrder':
      return [{ kind: 'resolution', title: 'Cancelled', subtitle: `Order ${d['orderId']}`, status: 'CANCELLED' }];
    case 'requestReturn':
      return [{ kind: 'resolution', title: 'Return requested', subtitle: `Order ${d['orderId']}`, status: 'RETURN_REQUESTED' }];
    case 'requestReplacement':
      return [{ kind: 'resolution', title: 'Replacement requested', subtitle: `Order ${d['orderId']}`, status: 'REPLACEMENT_REQUESTED' }];
    case 'getRefundStatus': {
      const r = (d['refund'] ?? {}) as Record<string, unknown>;
      return [{ kind: 'refund', title: 'Refund', subtitle: `${r['method'] ?? 'UPI'}`, status: String(r['status'] ?? 'N/A') }];
    }
    case 'getProduct': {
      const p = result.data as { productId: string; name: string; priceInr: number; rating: number };
      return [{ kind: 'product', title: p.name, subtitle: speakInr(p.priceInr), status: `★ ${p.rating}` }];
    }
    case 'findProducts': {
      const s = result.data as { matches: { productId: string; name: string; brand: string; category: string; priceInr: number; rating: number; inStock: boolean; description: string }[] };
      return (s.matches ?? []).map((p) => ({
        kind: 'shopping' as const,
        title: p.name,
        subtitle: `${p.brand} · ${p.category}`,
        status: `★ ${p.rating}`,
        product: {
          productId: p.productId,
          name: p.name,
          brand: p.brand,
          category: p.category,
          priceInr: p.priceInr,
          rating: p.rating,
          inStock: p.inStock,
          description: p.description,
        },
        action: { label: 'View details' },
      }));
    }
    default:
      return null;
  }
}

// Re-export helper used server-side for readability in tests.
export function orderSpeech(order: { orderId: string; status: string }, delayDays = 0): string {
  void delayDays;
  return formatTrackResult(order as never);
}