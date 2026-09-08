import type { SessionInfo, LiveMetrics } from '../useVaani';
import type { ConversationState } from '@vaaniresolve/shared';

export function DevPanel({ open, session, state, metrics, generation, turnId, speechFallback }: { open: boolean; session: SessionInfo | null; state: ConversationState; metrics: LiveMetrics; generation: number; turnId: number; speechFallback: boolean }) {
  if (!open) return null;
  const rows: [string, string][] = [
    ['Session', session?.sessionId ?? '—'],
    ['Turn', String(turnId)],
    ['Generation', String(generation)],
    ['State', state],
    ['Voice provider', speechFallback ? 'FALLBACK (disclosed)' : 'Rime (primary)'],
    ['Rime model', session?.rime.model ?? '—'],
    ['Rime speaker', session?.rime.speaker ?? '—'],
    ['Rime language', session?.rime.language ?? '—'],
    ['Rime endpoint', session?.rime.endpoint ?? '—'],
    ['Agent', session?.agent ?? '—'],
    ['STT', 'Web Speech API (browser)'],
    ['Interrupt count', String(metrics.interruptCount)],
    ['Cancelled requests', String(metrics.cancelledRequests)],
    ['Stale results discarded', String(metrics.staleResultsDiscarded)],
    ['Generation bumps', String(metrics.generationBumps)],
    ['TTFA (last)', metrics.ttfaMs ? `${metrics.ttfaMs} ms` : '—'],
    ['Tool latency (last)', metrics.toolLatencyMs ? `${metrics.toolLatencyMs} ms` : '—'],
    ['LLM latency (last)', metrics.llmMs ? `${metrics.llmMs} ms` : '—'],
    ['Interrupt→audio stop', metrics.lastInterruptionToAudioStopMs ? `${metrics.lastInterruptionToAudioStopMs} ms` : '—'],
  ];

  return (
    <aside className="block w-80 shrink-0 border-l border-white/10 bg-ink-800/60 backdrop-blur p-4 overflow-y-auto text-xs" aria-label="Developer panel">
      <h3 className="font-display text-sm font-bold tracking-wide text-white/90 mb-3">Developer Panel</h3>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-white/50">{k}</dt>
            <dd className="font-mono text-white/90 text-right break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className="font-display text-xs font-bold text-white/70 mt-5 mb-2">Event log</h4>
      <ul className="space-y-1 font-mono text-[10px] text-white/60">
        {metrics.events.slice(-12).map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-white/30">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="text-emerald-300/90">{e.event}</span>
            {e.detail && <span className="truncate text-white/40">— {e.detail}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}