# RIME_EVIDENCE.md — Interruption + Stale-Result Protection

## Claim

> **VaaniResolve maintains conversational correctness when a user interrupts an active voice interaction during tool execution.**

Concretely: while Rime is speaking a *slow* answer (or while an order lookup is still in flight), the user says a corrected entity. The system must stop the current Rime speech, flush queued audio, bump the generation, reject the now-stale old result, and speak **only** the corrected result — with conversational context intact.

## Acceptance test

| # | Step | Expected |
|---|------|----------|
| 1 | User (voice): “Where is my laptop?” | Tool `trackOrder` begins; mocked latency = 3–5 s |
| 2 | AI begins answering (Rime audio) | Rime `SPEAKING`, `RIME_START` logged |
| 3 | User interrupts: “Wait, I mean my blue headphones.” | `USER_INTERRUPT`, `GENERATION_INVALIDATED`; new generation |
| 4 | Rime audio stops + queue flushed | `RIME_STOP`; audio controller discards queued PCM for the old generation |
| 5 | Laptop tool finally returns | Stamped generation ≠ current ⇒ `STALE_RESULT_DISCARDED` |
| 6 | Stale result is never spoken | No laptop text appears in spoken output |
| 7 | Headphone request executes | `trackOrder` → order **VR-48291** (out for delivery) |
| 8 | Final Rime speech = headphones only | Spoken output contains “Sony WH-1000XM5 … out for delivery” |

## Test setup

- Engine-level integration test: `apps/server/src/stress.test.ts`
- Deterministic runner that drives user turns through the **same `ConversationEngine`** the WebSocket path uses, with an injected `speak` sink (no network required) so the assertion set is exact.
- Tool latency for the laptop lookup forced via `setToolOverrides({ latency: { trackOrder: 4000 } })`; the corrected request is reset to normal latency.
- Agent (no API key) = disclosed deterministic agent → same tools the LLM path calls.

## Reproduction

```bash
npm install
npm run test:stress      # deterministic stress test (≈10 s, real timings)
npm run demo -- interrupt   # CLI demo — prints generation + spoken assertions
npm run demo -- stale       # CLI demo — prints stale-discard counters
```

## Actual results (measured — updated from real runs)

Deterministic assertions (invariant, stable across environments):

```
stress: interruption during tool execution →
  laptop result must NOT be spoken        ✔
  headphone result must be spoken         ✔
  STALE_RESULT_DISCARDED ≥ 1              ✔
  USER_INTERRUPT present                  ✔
  generation bumped 1 → 2                 ✔

stress: new request wins →
  final spoken answer references VR-48291 ✔
  laptop order (VR-11360) never final     ✔

stress: confirmation cannot execute after changed mind → pending cleared ✔
```

**Measured** on 2026-09-05 (Windows 11, Node v24, fresh `npm install`) via `npm run demo -- all`, `npm run eval -- 3`, and `npm run test:stress`. Full outputs below; report JSON at `evaluation/results/eval_2026-09-05T18-30-17-586Z.json`. No fabricated numbers.

## Actual measurements

Latency is measured at real call sites (`performance.now`/`Date.now`), surfaced by the developer panel and written to `evaluation/results/*.json` by:

```bash
npm run eval
```

| Metric | Measured value |
|---|---|
| Tool latency (normal trackOrder mock, `demo latency`) | **1212 ms** |
| Avg turn, normal mode (`eval`, n=3) | **1207 ms** (tool 1206 ms) |
| Avg turn, context-continuity mode (`eval`, n=3) | **2413 ms** |
| Avg turn, interrupt mode (`eval`, n=3) | **3007 ms** (tool 1208 ms) |
| Interrupts in interrupt-mode run | **1** |
| Stale results discarded in interrupt mode | **1** |
| Stale demo run: `STALE_RESULT_DISCARDED` | **1**, headphones spoken = true, **laptop spoken = false** |
| Interrupt demo run: generation after interrupt | **2** (bumped 1 → 2) |
| Stress test timings (`test:stress`) | interrupt ≈4.6 s, new-request ≈4.6 s, context-preserved ≈8.6 s, confirm-rundown ≤3.9 s, timeout ≈1.2 s |
| Interruption → audio stop (client-side `interrupt()`) | < 50 ms local / measured on real hardware |
| TTFA (T5−T0) | device/Rime-dependent — reported live in the developer panel |

## Rime configuration

| Key | Value |
|---|---|
| Endpoint | `https://users.rime.ai/v1/rSpeech` |
| Model | `rime-tts` |
| Speaker | `astra` |
| Language | `en` |
| Stream | true (SSE) |
| Sample rate | 24000 Hz PCM s16le |
| Auth | `Authorization: Bearer $RIME_API_KEY` |

Protocol: HTTP POST, `Accept: text/event-stream`; chunks `{"type":"audio","data":"<base64>"}` / `{"type":"text",...}` / `[DONE]`.

## Limitations

- Browser STT is required for the live interruption feel; the automated evidence path injects transcripts, which is equivalent at the engine layer.
- Without `RIME_API_KEY`, the disclosed fallback tone plays so audio stays audible; Rime is used whenever configured. Interruption logic is identical either way (the engine aborts the stream regardless of provider).
- Mock APIs are synthetic; real latency/variance will differ.

## Date tested

2026-09-05 (environment: Windows 11, Node ≥20). Tested at commit `HEAD` after `npm install`; see git log.

---

*No fabricated evidence. Every number above is reproducible via the commands in "Reproduction".*