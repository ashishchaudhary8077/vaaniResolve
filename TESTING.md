# Testing

## Commands

```bash
npm test                        # all workspaces (state/tools/rime/agent/voice + server)
npm run test:stress             # app-server deterministic stress tests
npm run demo -- all             # real demo modes → PASS/FAIL (evidence)
npm run eval -- 3               # 3-sample measured evaluation → evaluation/results
npm run scan:secrets            # secret scan
npm run typecheck               # tsc across every workspace
npm run build                   # typecheck + vite build (web)
```

## Coverage areas

### Deterministic stress test (centerpiece) — `apps/server/src/stress.test.ts`
- `stress: interruption during tool execution → stale laptop result never spoken, headphones only`
- `stress: new request wins`
- `stress: context preserved across interruption`
- `stress: confirmation cannot execute after a changed mind`
- `stress: voice confirmation "yes, go ahead" executes the destructive tool`
- `stress: voice "no, do not" declines without mutating anything`
- `stress: tool timeout produces a graceful error, never a hang`

### Unit tests
- `packages/state` — `ConversationManager`: generation invalidation, stale detection, new-request-wins, context preservation, confirmation cancellation, generation stability without interruption.
- `packages/tools` — product/order resolution (headphones→VR-48291, laptop→VR-11360), id precedence, validation, latency override, graceful timeout, mutation log.
- `packages/rime` — request building (auth/PCM/stream), SSE chunk parser (audio/text/done), disclosed PCM fallback (deterministic), speech formatter terseness.
- `packages/agent` — deterministic intent for the demo utterances, destructive→confirmation, changed-mind, VR-id parse, markdown-JSON tolerance.
- `packages/voice` — queue flush on generation change, obsolete-generation discard (never enqueued), stop/interrupt clearing, current-generation accepted.

## What "test" means here
Unit tests are deterministic (fixed seeds, injected `speak`, injected clock/latency). The stress test is **real**: it drives the actual `ConversationEngine`, real tool executor with realistic (overridable) latency, and asserts end-to-end invariants with measured counters — not mocks of the engine itself.

Run everything, then fix any failure — the repo is kept green at `HEAD`.