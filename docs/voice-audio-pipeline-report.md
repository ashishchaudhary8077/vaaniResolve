# Voice & Audio Pipeline — Deep Analysis & Regression Report (Rime TTS)

**Scope:** Consolidate everything about the voice/audio pipeline in VaaniResolve — the Rime TTS path, the regressions found, the root causes, the fixes applied, and the residual risks. Evidence-based; all live facts verified during this session (2026-09-08).

**Status:** Report consolidated for the queue task. Note: no Supabase MCP/credentials are available in-session, so this is delivered as a local artifact rather than pushed to a queue.

---

## 1. The pipeline (as built, as read)

```
Rime rSpeech (HTTP POST, stream=true)
  → stream.ts  sniff RIFF vs SSE, strip WAV header, bytesToBase64(chunk)
  → engine.ts  speak(): send rime_chunk { audioBase64, sampleRate, generation }
  → index.ts   ws.send(JSON.stringify({...}))            // base64-as-ASCII in JSON
  → useVaani.ts  rime_chunk → queuePcm
  → audio.ts   pcmToAudioBuffer: atob → Int16Array → Float32 → AudioBuffer @ sampleRate
                → source → EQ chain → ctx.destination (gapless nextStartTime clock)
```

Files: `packages/rime/src/stream.ts` · `apps/server/src/engine.ts` · `apps/server/src/index.ts` · `apps/web/src/useVaani.ts` · `packages/voice/src/audio.ts`.

## 2. Verified Rime wire facts (live probe, this session)

A read-only POST to `https://users.rime.ai/v1/rSpeech` replicating `buildRequest()` (`stream.ts:99`) with text "Show me my orders":

| Fact | Value | Verdict |
|---|---|---|
| HTTP | `200 OK`, 68032 bytes, `content-type: text/event-stream` | healthy |
| Container | **WAV (RIFF/WAVE)** stream | matches `streamRime` WAV path (`stream.ts:164`) |
| Channels | **mono (1)** | client always decodes mono → **consistent** |
| Sample rate | **24,000 Hz** | matches `RIME_SAMPLE_RATE=24000` → **no rate mismatch** |
| Bit depth / encoding | **16-bit PCM (s16le)**, `bits=16` | client `int16 → float32 / 32768` is exact |
| Header | `dataSize=0xFFFFFFFF` (streaming unknown-length sentinel) | `parseWavHeader` walks chunks → handled |
| Payload | 67,988 bytes ≈ 33,994 frames ≈ 1.42 s, non-silent | real audio |

**Conclusion:** the Rime provider, key, endpoint, and format are NOT the problem. 24 kHz mono 16-bit PCM is produced as expected and consumed exactly as produced.

## 3. Regressions found → root cause → fix

The symptom reported by the user was "a badly tuned/distorted radio signal." Three layered causes were identified.

### 3.1 Backend port collision (primary — audio never reached the browser)
- `.env` had `PORT=8789`, but **omniroute** (the Claude Code runtime, `node …\omniroute\dist\server-ws.mjs`, PID 26140) owns `127.0.0.1:8789` and answers `AUTH_001` (its auth gate, not VaaniResolve).
- `server.listen(PORT)` (`index.ts:197`) had **no error handler** → `EADDRINUSE` → process crashed silently.
- The Vite proxy (`vite.config.ts:26`, `/ws` + `/api` target) pointed at 8789 → the frontend socket pointed at omniroute.
- **Fix applied:** `PORT=8790` in `.env` + `.env.example` (both server via `loadEnv.ts` `override:true`, and proxy via `vite.config.ts:18` which reads `.env` directly — no other config needed; frontend WS URL is relative `location.host/ws`). Added `server.on('error')` with an actionable `EADDRINUSE` message.

### 3.2 Fallback double-speak (secondary — the "radio" artifact itself)
- When Rime failed, `useVaani.ts` `rime_chunk` branch did **two things at once**: queued the disclosed PCM *tone* (`synthFallback` → `soundingSamples`, a word-gated dual-sinusoid at 22050 Hz) **and** spoke the text through the OS voice (`speakViaBrowser`/`speechSynthesis`). Two overlapping "voices" = the radio-like distortion.
- **Fix applied:** one voice path per sentence — Rime success → PCM only; fallback → `interruptLocal()` to silence residue, then browser TTS only (the tone chunk is deliberately not queued).

### 3.3 Over-aggressive client processing (amplifier of both)
- `audio.ts:61-82`: `highshelf +4 dB @ 2800 Hz → gain ×1.5 → DynamicsCompressor ratio 6, threshold −6, attack 4 ms`.
- On 24 kHz speech this exaggerates sibilance and pumps — harsh/static on laptop speakers; it magnified whatever played.
- **Fix applied (preserving chain structure):** `highshelf +1.25 dB`, `gain ×1.12`, `compressor ratio 2.2, threshold −12, knee 12, attack 8 ms, release 250 ms`.

## 4. What was deliberately NOT changed (format integrity)

Per the requirement to preserve Rime audio: sample rate stays 24,000 Hz; codec stays 16-bit PCM; no extra resampling added; no PCM→other-format conversion; mono kept; the WAV-header-strip → PCM-chunk → base64 → JSON-WS → Int16→Float32 → AudioBuffer chain untouched. The diagnosis verified this chain byte-safe and rate-correct end-to-end.

## 5. Residual risks (honest list)

1. **Odd-byte chunk boundary:** `Math.floor(bytes.byteLength/2)` (`audio.ts:243`) drops the trailing byte of an odd-length network chunk — at most one sample per odd boundary (inaudible), never cascading.
2. **Mono assumption:** safe today (probe = mono), but `parseWavHeader` reads `channels` and discards it; a future stereo WAV would mis-decode as mono (phasing). Non-urgent hardening: forward `channels`, enforce mono.
3. **Fallback tone quality:** if Rime genuinely fails, the browser-TTS fallback path is used (single voice — good), but the underlying `synthFallback` tone remains crude; only audible if one of the new guards is bypassed.
4. **`VITE_WS` escape hatch:** the frontend will use an explicit `VITE_WS` if set; none is set, so the proxy (→ 8790) governs today.
5. **Compressor still present** (very light, −12 dB threshold) — a pure safety limiter, engaged only on real peaks.

## 6. Verification state

| Check | Status |
|---|---|
| Port 8790 free + `.env`/`.env.example` updated | ✅ done (live netstat earlier confirmed 8790 free; 8789 = omniroute) |
| Server `EADDRINUSE` error handler | ✅ implemented |
| Double-speak removed (single voice path) | ✅ implemented (`useVaani.ts`) |
| EQ neutralized (values above) | ✅ implemented (`audio.ts`) |
| `npm run typecheck` (all 8 workspaces) | pending — run started, interrupted by session pivot |
| `npm test` (tools/voice/state/agent/server) | pending |
| Live smoke: server on 8790, Vite 5173, WS connects, one demo turn speaks | pending |

The fixes are **code-complete**; the final run is queued as task #17 and will be executed as part of the DTS authorization work's verification pass.