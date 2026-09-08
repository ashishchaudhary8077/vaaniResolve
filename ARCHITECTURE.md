# Architecture

VaaniResolve is a TypeScript npm-workspaces monorepo. ASCII flow:

```
browser (apps/web)                              server (apps/server)
┌────────────────────────────┐                  ┌──────────────────────────────┐
│ AudioPlaybackController     │  WS rime_chunk  │ ConversationEngine           │
│  (PCM queue + interrupt)    │◄───────────────►│  • ConversationManager        │
│ InterruptController         │  WS user_*      │    (state machine, generation)│
│ Web Speech STT              │────────────────►│  • Agent (Claude | det.)      │
│ Waveform / Transcript / Dev │                 │  • Tool Router → mock APIs   │
└────────────────────────────┘                  │  • Speech Formatter           │
                                                │  • Rime streaming TTS        │
                                                └──────────────┬───────────────┘
                                                               │ SSE/PCM
                                                        Rime `https://users.rime.ai/v1/rSpeech`
```

## Packages

- **`@vaaniresolve/shared`** — the protocol: `WireMessage` events, domain types, `SessionContext` (`{sessionId, turnId, generation, requestId}`), `ConversationState`, tool definitions.
- **`@vaaniresolve/state`** — `ConversationManager`: explicit state machine, generation counter, request ids, entity context (`activeOrder`/`activeProduct`/…), pending-action (confirmation) holder. **Every async op is stamped; `interrupt()` bumps generation and clears pending actions.**
- **`@vaaniresolve/tools`** — synthetic commerce dataset, tool registry + executor with realistic latency (`simulatedLatencyMs`), failure rates, `timeout`, and abort signals. `executeTool` returns `ToolResult` stamped with the request context; `validateArgs` enforces whitelist-only schemas.
- **`@vaaniresolve/agent`** — `Agent` with two disclosed modes: Claude (structured tool calling) when `ANTHROPIC_API_KEY` is set; otherwise a deterministic intent interpreter that drives the same tools. Both return a `ToolAction {tool, args}` + confirmation needs.
- **`@vaaniresolve/rime`** — streaming rSpeech client (`streamRime`), SSE chunk parser, fallback synthesizer (disclosed), and the speech formatter (`formatSpeechFromTool`) that turns tool output into concise spoken sentences.
- **`@vaaniresolve/voice`** — `AudioPlaybackController` (PCM→Float32→queue→play; `interrupt()`/`stop()`/`flushQueue()`; obsolete-generation discard at queue level) and `InterruptController`.
- **`apps/server`** — Express + `ws`. One `ConversationEngine` per connection. REST: `/api/health`, `/api/tools`, `/api/status`, `/api/metrics`. CLI: `src/demo.ts` (demo modes), `src/evaluate.ts` (measured evaluation).
- **`apps/web`** — React + Vite + Tailwind. `useVaani` owns WS + STT + audio + barge-in. Components: waveform, transcript, resolution cards, confirmation dialog, developer panel, demo chips.

## Generation / stale-result flow

1. `includeSession` — a user turn arrives: `ConversationEngine.handleUserSpeech`.
2. If another turn is active (`inflight`, `SPEAKING`, `PROCESSING`, `TOOL_RUNNING`), `interrupt()` runs: abort controller → `ConversationManager.interrupt()` (generation+1, clear pending) → emit `generation_bump`/`user_interrupt`.
3. New turn is stamped with the *current* (`generationAtStart`) context.
4. Tool/LLM results are checked with `stillCurrent(sessionId, turnId, generation)`:
   - mismatch ⇒ `STALE_RESULT_DISCARDED`, entity context is **not** applied, nothing is spoken.
5. Rime audio chunks are wrapped with the same generation; the client’s `AudioPlaybackController.setGeneration(gen)` flushes obsolete queued PCM.

**Invariant enforced at LLM result, tool result, speech generation and playback queue: NO OBSOLETE GENERATION MAY EVER BE SPOKEN.**

## State machine

`IDLE → LISTENING → PROCESSING → TOOL_RUNNING → SPEAKING → RESOLVED`
with `INTERRUPTED`, `WAITING_CONFIRMATION`, `EXECUTING_ACTION`, `ERROR` branches. The server broadcasts `state_change`; the UI renders the current state and offers Stop/Interrupt controls.

## Interruption path

```
User speaks again / presses stop
  → client: InterruptController
  → WS user_interrupt (+ local audio.interrupt())
  → server: engine.interrupt()
  → abort Rime stream (AbortController) → RIME_STOP
  → ConversationManager.interrupt(): generation++, clear pending action
  → old LLM/tool results (when they return) are STALE → discarded
  → new turn executes
  → validated result spoken via Rime (current generation only)
```

## Latency model

`T0` user stops speaking (client sets `speechEndedAt`) · `T1` STT transcript · `T2` LLM decision · `T3` Rime request (`RIME_START`) · `T4` first Rime audio (`RIME_FIRST_AUDIO`) · `T5` first audible playback (client). `TTFA = T5 − T0`. Tool latency is captured in `ToolResult.latencyMs`. Stale/interrupt counters live in `Metrics`. See `evaluation/`.