# API

## WebSocket `/ws` — realtime protocol

Every message: `{ type, sessionId, turnId, generation, requestId, ts, payload? }`.

Client → Server

| type | payload | notes |
|---|---|---|
| `user_speech_start` | — | mic opened (start of barge-in window) |
| `user_speech_end` | `{ transcript, final, speechEndedAt }` | `speechEndedAt` = T0 |
| `user_interrupt` | — | stop button / barge-in |
| `confirmation_result` | `{ confirmationId, accepted }` | answer to a destructive-action prompt |

Server → Client

| type | payload | notes |
|---|---|---|
| `hello` | rime config, agent kind, tools | sent on connect |
| `generation_bump` | `{ prevGeneration }` | interruption happened; **client flushes old audio** |
| `state_change` | `{ state, tool?, utterance? }` | explicit state indicator |
| `assistant_text` | `{ text }` | caption/transcript line |
| `resolution` | `ResolutionCard` | order/product/refund/resolution card |
| `tool_start` / `tool_complete` | `{ tool, ... }` | tool progress |
| `tool_stale` | `{ tool }` | a result was discarded as superseded |
| `confirmation_required` | `{ confirmationId, action, tool, args, summary }` | destructive action gating |
| `rime_chunk` | `{ audioBase64, sampleRate, generation, disclosedFallback?, text? }` | streamed PCM (or fallback) |
| `rime_first_audio` | `{ ttfaMs? }` | T4 reached |
| `rime_stop` | — | speech ended/interrupted |
| `speech_finished` | — | utterance complete |
| `stale_result_discarded` | `{ stage, tool? }` | observability event |
| `error` | `{ code, message }` | engine/validation error |

## REST

| route | description |
|---|---|
| `GET /api/health` | service health + configured providers |
| `GET /api/tools` | tool whitelist (name, description, destructive, domain) |
| `GET /api/status` | Rime config (model/speaker/lang/endpoint) + agent kind |
| `GET /api/metrics` | measured latency + interrupt/stale counters + event log |

## Client surface (apps/web)

`useVaani(wsUrl)` returns state + actions:

```ts
{
  connected, state, session, transcripts, cards, confirmation,
  listening, interim, toolsRunning, metrics, speechFallback,
  startListening(mode: 'hold'|'continuous'),
  stopListening(), interrupt(), answerConfirmation(accept, id),
  sendTextTurn(text), patch(cb)
}
```

## Internal package surface

- `ConversationManager` — `.interrupt()`, `.newRequestId()`, `.snapshot()`, `.setEntity()`, `.setPendingAction()`, `.clearPendingAction()`, `.markStaleIfNeeded()`, `.isCurrent()`.
- `executeTool(name, args, ctx, opts)` → `Promise<ToolResult>` stamped with request context.
- `Agent.decide({conversation}, text)` → `AgentDecision` (`{kind, tool, args, intent, speech, needsConfirmation, confirmSummary}`).
- `streamRime(config, utterance, onChunk, {signal})` → `{abort(), done()}`
- `AudioPlaybackController` — `enqueue(item)`, `interrupt()`, `stop()`, `pause()`, `resume()`, `setGeneration(gen)`, `hardClear()`; obsolete-generation chunks are discarded at `enqueue`.
- `formatSpeechFromTool(tool, result)` → concise spoken sentence.

## Example

```
c→s  {"type":"user_speech_end","payload":{"transcript":"where is my laptop?","speechEndedAt":169...}}
s→c  {"type":"state_change","payload":{"state":"PROCESSING"}}
s→c  {"type":"tool_start","payload":{"tool":"trackOrder","status":"start"}}
s→c  {"type":"generation_bump","payload":{"prevGeneration":1}}   // user interrupted
s→c  {"type":"rime_chunk","payload":{"sampleRate":24000,"generation":2,"audioBase64":"..."}}
s→c  {"type":"resolution","payload":{"kind":"order","title":"#VR-48291",...}}
s→c  {"type":"state_change","payload":{"state":"RESOLVED"}}
```