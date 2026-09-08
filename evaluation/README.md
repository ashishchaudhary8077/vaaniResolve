# evaluation/

Latency evaluation harness + captured results (spec section 12).

## Usage

```bash
npm run eval -- 5          # 5 samples per mode
npm run demo -- all        # evidence runner for the demo
```

`eval` runs three modes and writes a JSON report per run:

- **normal** — one tracking turn (T0→speech), measures LLM + tool latency.
- **context_continuity** — three chained turns (track → "when will it arrive?" → cancel) measures multi-turn correctness.
- **interrupt** — the laptop→headphones correction: measures interruption, generation bump, and stale-result discard.

Every number is measured at real call sites; nothing is fabricated. Reports land in `evaluation/results/eval_<timestamp>.json`.

## Metric definitions

| symbol | meaning | where measured |
|---|---|---|
| T0 | user stops speaking | client `speechEndedAt` |
| T1 | usable STT | Web Speech final result |
| T2 | LLM decision | `Agent.decide` returns |
| T3 | Rime request sent | `RIME_START` event |
| T4 | first Rime audio | `RIME_FIRST_AUDIO` event |
| T5 | first audible playback | client first chunk played |
| TTFA | T5 − T0 | dev panel + report |

Also tracked: interruption→audio-stop ms, tool latency, stale-result count, correction success, cancel/reconcile success, failure rate.