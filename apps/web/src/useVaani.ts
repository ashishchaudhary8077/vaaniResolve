/**
 * useVaani — client controller. Owns the WebSocket, Web Speech STT, Rime PCM
 * playback via AudioPlaybackController, and wire-level interruption.
 *
 * Barge-in: when a (final) user transcript is produced while the assistant is
 * speaking or a tool is running, the client sends `user_interrupt` then queues
 * the new turn. The server bumps generation, aborts Rime and invalidates stale
 * work — the product USP (listen while it works).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationState, ResolutionCard, SessionContext, ConfirmationPayload, WireMessage } from '@vaaniresolve/shared';
import { AudioPlaybackController } from '@vaaniresolve/voice';

export interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  generation: number;
  ts: number;
}

export interface LiveMetrics {
  ttfaMs?: number;
  llmMs?: number;
  toolLatencyMs?: number;
  interruptCount: number;
  staleResultsDiscarded: number;
  cancelledRequests: number;
  generationBumps: number;
  lastInterruptionToAudioStopMs?: number;
  events: { ts: number; event: string; detail?: string }[];
}

export interface SessionInfo {
  sessionId: string;
  turnId: number;
  generation: number;
  rime: { provider: string; model: string; speaker: string; language: string; endpoint: string; configured: boolean };
  agent: string;
  tools: string[];
}

export interface VaaniState {
  connected: boolean;
  /** true while a first connection attempt is in flight (before the WS ever opened). */
  connecting: boolean;
  /** true once the voice channel dropped and we are retrying in the background. */
  reconnecting: boolean;
  state: ConversationState;
  session: SessionInfo | null;
  transcripts: TranscriptItem[];
  cards: ResolutionCard[];
  confirmation: ConfirmationPayload | null;
  listening: boolean;
  interim: string;
  toolsRunning: string[];
  metrics: LiveMetrics;
  speechFallback: boolean;
}

const IDLE: VaaniState = {
  connected: false,
  connecting: true,
  reconnecting: false,
  state: 'IDLE',
  session: null,
  transcripts: [],
  cards: [],
  confirmation: null,
  listening: false,
  interim: '',
  toolsRunning: [],
  metrics: { interruptCount: 0, staleResultsDiscarded: 0, cancelledRequests: 0, generationBumps: 0, events: [] },
  speechFallback: false,
};

type AnyRec = {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function useVaani(wsUrl: string) {
  const [ui, setUi] = useState<VaaniState>(IDLE);
  const stateRef = useRef(IDLE);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<AudioPlaybackController>(new AudioPlaybackController());
  const ctxRef = useRef<SessionContext>({ sessionId: '', turnId: 0, generation: 0, requestId: '' });
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | undefined>(undefined);

  const patch = useCallback((update: Partial<VaaniState> | ((u: VaaniState) => Partial<VaaniState>)) => {
    setUi((u) => {
      const next: VaaniState = { ...u, ...(typeof update === 'function' ? update(u) : update) };
      stateRef.current = next;
      return next;
    });
  }, []);

  const pushTranscript = useCallback((item: Omit<TranscriptItem, 'id' | 'ts'>) => {
    setUi((u) => {
      const ts = Date.now();
      const next = { ...u, transcripts: [...u.transcripts, { ...item, id: `tr-${ts}-${Math.random().toString(36).slice(2, 6)}`, ts }].slice(-80) };
      stateRef.current = next;
      return next;
    });
  }, []);

  const send = useCallback((msg: Omit<WireMessage, 'ts'>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...msg, ts: Date.now() }));
  }, []);

  /* -------------------------------------------------------------- audio */

  const queuePcm = useCallback((audioBase64: string, sampleRate: number, generation: number, ctx: SessionContext) => {
    audioRef.current.enqueue({
      audioBase64,
      sampleRate,
      generation,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      requestId: ctx.requestId,
      chunkIndex: Math.floor(Math.random() * 1e6),
    });
  }, []);

  // Track the most recent assistant sentence so a Rime failure can still be
  // spoken through the browser's built-in SpeechSynthesis (no API key needed).
  const lastAssistantTextRef = useRef('');

  const interruptLocal = useCallback(() => {
    audioRef.current.interrupt();
  }, []);

  /* -------------------------------------------------------- browser TTS fallback */
  // Spoken when Rime genuinely fails so the response is still heard without a
  // key. Uses the browser's built-in SpeechSynthesis; never blocks on failure.
  const speakViaBrowser = useCallback((text: string) => {
    if (!text || typeof window === 'undefined') return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'en-IN';
      utt.rate = 1;
      window.speechSynthesis.speak(utt);
    } catch {
      /* speechSynthesis unavailable — audio card still visible */
    }
  }, []);

  /* -------------------------------------------------------------- ws */

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let ws: WebSocket | null = null;

    // Background reconnect with capped exponential backoff. A transient drop
    // (server restart, idle socket) recovers on its own instead of killing the
    // session — the UI shows "Assistant unavailable — retrying…" meanwhile.
    const scheduleRetry = () => {
      if (disposed) return;
      if (retryTimer) window.clearTimeout(retryTimer);
      const retries = (scheduleRetry as unknown as { n?: number }).n ?? 0;
      (scheduleRetry as unknown as { n: number }).n = retries + 1;
      retryTimer = window.setTimeout(() => retries < 12 && connect(), Math.min(800 * 1.6 ** Math.min(retries, 5), 6000));
    };

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        (scheduleRetry as unknown as { n: number }).n = 0;
        patch({ connected: true, connecting: false, reconnecting: false, state: 'IDLE' });
      });
      ws.addEventListener('close', () => {
        if (disposed) return;
        patch((u) => ({ connected: false, reconnecting: u.connecting ? false : true }));
        if (wsRef.current === ws) wsRef.current = null;
        scheduleRetry();
      });
      ws.addEventListener('error', () => patch({ connected: false }));

      ws.addEventListener('message', (ev) => {
      let msg: WireMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      ctxRef.current = { sessionId: msg.sessionId, turnId: msg.turnId, generation: msg.generation, requestId: msg.requestId };
      const ctx = ctxRef.current;

      switch (msg.type) {
        case 'hello': {
          const p = (msg.payload ?? {}) as SessionInfo;
          audioRef.current.setGeneration(msg.generation);
          patch({ session: p, connected: true, state: 'IDLE' });
          pushTranscript({ role: 'system', text: `Connected. I'm VaaniResolve — talk, interrupt, resolve. Try “where is my laptop?” or “my blue headphones.”`, generation: msg.generation });
          break;
        }
        case 'generation_bump': {
          // Flush queued obsolete audio; the state chip already shows
          // "Interrupted" so no debug text is added to the transcript.
          audioRef.current.setGeneration(msg.generation);
          break;
        }
        case 'state_change': {
          patch({ state: (msg.payload as { state?: ConversationState }).state ?? 'IDLE' });
          break;
        }
        case 'assistant_text': {
          const text = (msg.payload as { text?: string }).text ?? '';
          lastAssistantTextRef.current = text;
          pushTranscript({ role: 'assistant', text, generation: msg.generation });
          break;
        }
        case 'resolution': {
          const payload = msg.payload as ResolutionCard | ResolutionCard[];
          patch({ cards: Array.isArray(payload) ? payload : [payload] });
          break;
        }
        case 'confirmation_required': {
          patch({ confirmation: msg.payload as ConfirmationPayload, state: 'WAITING_CONFIRMATION' });
          break;
        }
        case 'rime_chunk': {
          const p = msg.payload as { audioBase64?: string; sampleRate?: number; generation?: number; disclosedFallback?: boolean; reason?: string };
          // Exactly ONE voice path per sentence:
          //   • success  — real Rime PCM is the only output (queued below);
          //   • fallback — the browser's built-in TTS speaks the response text,
          //     and the disclosed PCM "tone" chunk is deliberately NOT queued,
          //     so the two sources can never overlap (no radio-like double-speak).
          if (p.disclosedFallback) {
            patch({ speechFallback: true });
            console.info('[vaani] fallback TTS:', p.reason ?? 'fallback active');
            interruptLocal(); // silence any still-playing Rime audio first
            if (lastAssistantTextRef.current) speakViaBrowser(lastAssistantTextRef.current);
          } else if (p.audioBase64) {
            queuePcm(p.audioBase64, p.sampleRate ?? 24000, p.generation ?? msg.generation, ctx);
          }
          break;
        }
        case 'rime_first_audio': {
          const p = msg.payload as { ttfaMs?: number; disclosedFallback?: boolean; reason?: string };
          if (p.disclosedFallback) {
            patch({ speechFallback: true });
            console.info('[vaani] fallback TTS:', p.reason ?? 'fallback active');
          }
          if (p.ttfaMs) patch((u) => ({ metrics: { ...u.metrics, ttfaMs: p.ttfaMs } }));
          break;
        }
        case 'rime_stop': {
          audioRef.current.interrupt(); // client-side stop safety net
          break;
        }
        case 'tool_start': {
          const tool = (msg.payload as { tool?: string }).tool ?? '';
          patch({ toolsRunning: stateRef.current.toolsRunning.includes(tool) ? stateRef.current.toolsRunning : [...stateRef.current.toolsRunning, tool] });
          break;
        }
        case 'tool_stale': {
          // Internal telemetry only — an obsolete result was discarded and never
          // spoken. No tool names or internal detail in the visible transcript.
          console.info('[vaani] stale result discarded (never spoken)');
          break;
        }
        case 'stale_result_discarded': {
          patch((u) => ({ metrics: { ...u.metrics, staleResultsDiscarded: u.metrics.staleResultsDiscarded + 1 } }));
          break;
        }
        case 'error': {
          // Full detail stays in the server log; the user sees a clean note only.
          const e = msg.payload as { message?: string };
          console.error('[vaani] server error:', e.message ?? 'unknown');
          pushTranscript({ role: 'system', text: 'Something went wrong. Please try again.', generation: msg.generation });
          break;
        }
        default:
          break;
      }
    });
      };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [wsUrl, patch, pushTranscript, queuePcm, speakViaBrowser, interruptLocal]);

  /* -------------------------------------------------------------- STT */

  const interruptNow = useCallback(() => {
    const ctx = ctxRef.current;
    interruptLocal();
    send({ type: 'user_interrupt', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: String(ctx.generation) });
  }, [interruptLocal, send]);

  /** finalize a transcript: barge-in if assistant is busy, then send the turn. */
  const finalizeTranscript = useCallback(
    (text: string) => {
      const ctx = ctxRef.current;
      const active = stateRef.current.state;
      if (active === 'SPEAKING' || active === 'PROCESSING' || active === 'TOOL_RUNNING') {
        interruptLocal();
        send({ type: 'user_interrupt', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: String(ctx.generation) });
      }
      pushTranscript({ role: 'user', text, generation: ctx.generation });
      send({ type: 'user_speech_end', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: `r_${Date.now()}`, payload: { transcript: text, final: true, speechEndedAt: Date.now() } });
    },
    [interruptLocal, pushTranscript, send],
  );

  const startListening = useCallback(
    (mode: 'hold' | 'continuous') => {
      const w = window as typeof window & AnyRec;
      if (!w.webkitSpeechRecognition) {
        pushTranscript({ role: 'system', text: 'Speech recognition needs Chrome or Edge. You can also tap the text box and type.', generation: ctxRef.current.generation });
        return;
      }
      const active = stateRef.current.state;
      if (active === 'SPEAKING' || active === 'PROCESSING' || active === 'TOOL_RUNNING') {
        interruptNow();
      }
      patch({ listening: true, interim: '' });

      const rec = new w.webkitSpeechRecognition();
      rec.continuous = mode === 'continuous';
      rec.interimResults = true;
      rec.lang = 'en-IN';
      rec.maxAlternatives = 1;
      recRef.current = rec;

      rec.onresult = (ev) => {
        let interim = '';
        let final = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const txt = r[0]?.transcript ?? '';
          if (r.isFinal) final += txt;
          else interim += txt;
        }
        if (interim) patch({ interim });
        if (final && final.trim()) {
          patch({ interim: '' });
          finalizeTranscript(final.trim());
        }
      };

      rec.onend = () => {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        patch({ listening: false, interim: '' });
        if (mode === 'continuous' && !stoppingRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            try {
              recRef.current?.start();
            } catch {
              /* noop */
            }
          }, 250);
        }
      };

      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        patch({ listening: false });
        // Friendly copy only — the raw Web Speech code stays in the console.
        const friendly: Record<string, string> = {
          'not-allowed': 'Microphone access was denied — enable it in your browser and try again.',
          'service-not-allowed': 'Speech recognition is off for this site — check your browser settings.',
          'audio-capture': 'No microphone was found — check your mic and try again.',
          network: 'Speech recognition is unreachable right now — try again in a moment.',
        };
        console.warn('[vaani] speech-recognition error:', e.error);
        pushTranscript({ role: 'system', text: friendly[e.error] ?? 'Voice recognition hiccuped — please try again.', generation: ctxRef.current.generation });
      };

      try {
        rec.start();
      } catch {
        /* already started */
      }
      void mode;
    },
    [finalizeTranscript, interruptNow, patch, pushTranscript],
  );

  /** Send a typed turn (accessibility fallback — voice is primary). */
  const sendTextTurn = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      const ctx = ctxRef.current;
      const active = stateRef.current.state;
      if (active === 'SPEAKING' || active === 'PROCESSING' || active === 'TOOL_RUNNING') {
        interruptLocal();
        send({ type: 'user_interrupt', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: String(ctx.generation) });
      }
      pushTranscript({ role: 'user', text: t, generation: ctx.generation });
      send({ type: 'user_speech_end', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: `r_${Date.now()}`, payload: { transcript: t, final: true, speechEndedAt: Date.now() } });
    },
    [interruptLocal, pushTranscript, send],
  );

  const stopListening = useCallback(() => {
    stoppingRef.current = true;
    recRef.current?.stop();
    patch({ listening: false });
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
  }, [patch]);

  const interrupt = interruptNow;

  const answerConfirmation = useCallback(
    (accept: boolean, confirmationId: string) => {
      const ctx = ctxRef.current;
      send({ type: 'confirmation_result', sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, requestId: `cf_${Date.now()}`, payload: { confirmationId, accepted: accept } });
      patch({ confirmation: null });
      pushTranscript({ role: 'user', text: accept ? 'Yes, go ahead.' : "No, don't do that.", generation: ctx.generation });
    },
    [pushTranscript, send, patch],
  );

  const stoppingRef = useRef(false);

  /* -------------------------------------------------------------- metrics */

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/metrics`);
        const m = await r.json();
        patch({
          metrics: {
            ttfaMs: m.lastTtfaMs,
            interruptCount: m.interruptCount,
            staleResultsDiscarded: m.staleResultsDiscarded,
            cancelledRequests: m.cancelledRequests,
            generationBumps: m.generationBumps,
            lastInterruptionToAudioStopMs: m.lastInterruptionToAudioStopMs,
            toolLatencyMs: m.latencies?.at(-1)?.toolLatencyMs,
            llmMs: m.latencies?.at(-1)?.llmMs,
            events: (m.events ?? []).slice(-30).map((e: { ts: number; event: string; detail?: string }) => ({ ts: e.ts, event: e.event, detail: e.detail })),
          },
        });
      } catch {
        /* ignore */
      }
    };
    const t = window.setInterval(poll, 2000);
    poll().catch(() => undefined);
    return () => window.clearInterval(t);
  }, [patch]);

  /* -------------------------------------------------------- first-gesture unlock */

  useEffect(() => {
    let unlocked = false;
    const handler = () => {
      if (unlocked) return;
      unlocked = true;
      audioRef.current.unlock();
    };
    window.addEventListener('pointerdown', handler, { once: false, capture: true });
    window.addEventListener('keydown', handler, { once: false, capture: true });
    return () => {
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('keydown', handler, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    };
  }, []);

  return {
    ...ui,
    startListening,
    stopListening,
    interrupt,
    answerConfirmation,
    sendTextTurn,
    speakViaBrowser,
    patch,
  };
}

/* ---------- minimal Web Speech typings (browser API is not in lib.dom for
   webkit prefixed) ---------- */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

/** helper used by callback deps */
export type { ConversationState, ResolutionCard };