/**
 * Rime — PRIMARY and ESSENTIAL TTS provider (spec section 6).
 *
 * Uses the streaming Rime "rSpeech" HTTP endpoint. Configuration comes
 * exclusively from environment variables:
 *
 *   RIME_API_KEY=
 *   RIME_ENDPOINT=https://users.rime.ai/v1/rSpeech
 *   RIME_MODEL=rime-tts
 *   RIME_SPEAKER=<valid voice, e.g. astra>
 *   RIME_LANGUAGE=en
 *
 * Transport (verified against the live API): HTTP POST `stream: true` returns
 * a single contiguous RIFF/WAV (PCM s16le at `sampling_rate`) stream, even with
 * `Accept: text/event-stream`. Some account/configurations may emit an SSE JSON
 * stream of {type:"audio"|"text", data} terminated by `[DONE]`. `streamRime`
 * sniffs the first bytes and decodes whichever framing the server actually uses:
 *   • RIFF → strip the 44-byte WAV header once, then stream raw PCM s16le base64;
 *   • SSE  → reuse `parseSseChunk` for base64 PCM / text / done tokens.
 * Callers only ever see { audioBase64?, text?, done? } — the wire format is
 * decoupled from the rest of the pipeline.
 *
 * Fallback TTS exists ONLY for resilience (Rime key missing / genuine network
 * or HTTP failure) and is disclosed in the developer panel and server logs.
 */

import type { SpeechUtterance } from '@vaaniresolve/shared';

export interface RimeConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  speaker: string;
  language: string;
  sampleRate: number;
}

export interface RimeChunk {
  audioBase64?: string;
  text?: string;
  done?: boolean;
  /** real PCM sample rate from the WAV header when a WAV stream was decoded. */
  sampleRate?: number;
}

export interface RimeStreamHandle {
  abort(): void;
  done(): Promise<void>;
}

export function loadRimeConfig(env: Record<string, string | undefined> = {}, log: (m: string) => void = console.log): RimeConfig {
  const cfg: RimeConfig = {
    apiKey: env.RIME_API_KEY ?? '',
    endpoint: env.RIME_ENDPOINT ?? 'https://users.rime.ai/v1/rSpeech',
    model: env.RIME_MODEL ?? 'rime-tts',
    speaker: env.RIME_SPEAKER ?? 'astra',
    language: env.RIME_LANGUAGE ?? 'en',
    sampleRate: Number(env.RIME_SAMPLE_RATE ?? 24000),
  };
  if (!cfg.apiKey) {
    log('[rime] RIME_API_KEY is not set — Rime is unavailable. Falling back to disclosed non-Rime TTS.');
  } else {
    log(`[rime] configured model=${cfg.model} speaker=${cfg.speaker} language=${cfg.language} endpoint=${cfg.endpoint}`);
  }
  return cfg;
}

export function parseSseChunk(raw: string): RimeChunk | null {
  if (!raw) return null;
  let payload = raw.trim();
  let isData = payload.startsWith('data:');
  if (isData) payload = payload.slice(5).trim();
  // SSE terminator — both bare and `data:` prefixed forms.
  if (payload === '[DONE]') return { done: true };
  if (isData) {
    try {
      const obj = JSON.parse(payload);
      if (obj && typeof obj === 'object') {
        const chunk: RimeChunk = {};
        if (obj.type === 'audio') {
          if (typeof obj.data === 'string') chunk.audioBase64 = obj.data;
          if (obj.audio) chunk.audioBase64 = obj.audio;
        } else if (obj.type === 'text') {
          if (typeof obj.data === 'string') chunk.text = obj.data;
          else if (typeof obj.text === 'string') chunk.text = obj.text;
        }
        return chunk;
      }
    } catch {
      /* non-JSON data line */
    }
  }
  const maybeBase64 = payload;
  if (/^[A-Za-z0-9+/=]+$/.test(maybeBase64) && maybeBase64.length > 16) return { audioBase64: maybeBase64 };
  return null;
}

/** Build the HTTP request for a synth call — exported so tests hit no network. */
export function buildRequest(config: RimeConfig, utterance: SpeechUtterance, stream = true): { url: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (stream) headers.Accept = 'text/event-stream';

  // Rime documents `sampling_rate`; the rSpeech endpoint returns raw PCM s16le
  // at that rate (no output_format field). Sending only documented fields avoids
  // strict-schema 4xx responses.
  const body = JSON.stringify({
    model: config.model,
    speaker: config.speaker,
    lang: config.language,
    text: utterance.text,
    stream,
    sampling_rate: config.sampleRate,
  });
  return { url: config.endpoint, headers, body };
}

/** Stream-synthesize. Server-side only. Decodes either raw WAV or SSE framing. */
export async function streamRime(
  config: RimeConfig,
  utterance: SpeechUtterance,
  onChunk: (chunk: RimeChunk) => void,
  opts: { signal?: AbortSignal; fetchFn?: typeof fetch } = {},
): Promise<RimeStreamHandle> {
  const fetchFn = opts.fetchFn ?? fetch;
  const { url, headers, body } = buildRequest(config, utterance, true);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  if (opts.signal?.aborted) controller.abort();

  const resp = await fetchFn(url, { method: 'POST', headers, body, signal: controller.signal });
  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Rime HTTP ${resp.status}: ${detail.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let wavHeaderSeen = false;
  let wavSampleRate: number | undefined;
  let mode: 'wav' | 'sse' | null = null;
  let sseBuffer = '';

  const emitPcm = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0) return;
    onChunk({ audioBase64: bytesToBase64(chunk), sampleRate: wavSampleRate });
  };

  const pump = async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;

      // Decide the framing once, from the first payload bytes.
      if (mode === null) {
        const isRiff = value[0] === 0x52 /* R */ && value[1] === 0x49 /* I */ && value[2] === 0x46 /* F */ && value[3] === 0x46 /* F */;
        // SSE JSON begins with '{' or a 'data:'/'event:' line.
        const isSseText = value[0] === 0x7b /* { */ || looksLikeSse(new TextDecoder().decode(value));
        mode = isRiff ? 'wav' : isSseText ? 'sse' : 'sse'; // default to the documented SSE path
        if (mode === 'wav') {
          const parsed = parseWavHeader(value);
          if (parsed) {
            wavHeaderSeen = true;
            wavSampleRate = parsed.sampleRate || config.sampleRate;
            // The client must decode at the rate the server actually encoded at.
            emitPcm(value.subarray(parsed.dataOffset));
            continue;
          }
          // Malformed header — treat as data; tolerate rather than hang.
        }
      }

      if (mode === 'wav') {
        emitPcm(value);
        continue;
      }

      // SSE framing: accumulate and split on blank lines.
      sseBuffer += decoder.decode(value, { stream: true });
      sseBuffer = sseBuffer.replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = sseBuffer.indexOf('\n\n')) !== -1) {
        const block = sseBuffer.slice(0, idx);
        sseBuffer = sseBuffer.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const chunk = parseSseChunk(line);
          if (!chunk) continue;
          if (chunk.done) return;
          onChunk(chunk);
        }
      }
    }
    // Flush any remaining SSE payload (no trailing blank line).
    if (mode === 'sse' && sseBuffer) {
      for (const line of sseBuffer.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const chunk = parseSseChunk(line);
        if (chunk && chunk.done) return;
        if (chunk) onChunk(chunk);
      }
      sseBuffer = '';
    }
    void wavHeaderSeen;
  };

  const promise = pump().finally(() => opts.signal?.removeEventListener('abort', onAbort));
  return {
    abort: () => controller.abort(),
    done: () => promise,
  };
}

/**
 * Sniff whether an SSE text payload begins a JSON event or a `data:`/`event:`
 * line — i.e. the classic `{type:...}` SSE, vs raw PCM bytes that happens to
 * contain newline pairs.
 */
function looksLikeSse(text: string): boolean {
  const t = text.slice(0, 64).trimStart();
  return t.startsWith('{') || /^(data|event|id|retry):/.test(t);
}

/** Parse a RIFF/WAVE header, returning the byte offset where PCM data begins. */
export function parseWavHeader(bytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number } | null {
  if (bytes.length < 44) return null;
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (riff !== 'RIFF') return null;
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (wave !== 'WAVE') return null;
  const channels = bytes[22] | (bytes[23] << 8);
  const sampleRate = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)) >>> 0;
  const bitsPerSample = bytes[34] | (bytes[35] << 8);
  // Walk chunks to locate the 'data' chunk (robust to an extended fmt/extra).
  let off = 12;
  let dataOffset = -1;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = (bytes[off + 4] | (bytes[off + 5] << 8) | (bytes[off + 6] << 16) | (bytes[off + 7] << 24)) >>> 0;
    if (id === 'data') {
      dataOffset = off + 8;
      break;
    }
    off += 8 + size + (size % 2); // chunks are 2-byte aligned
  }
  if (dataOffset === -1) return null;
  return { sampleRate, channels, bitsPerSample, dataOffset };
}

/**
 * Disclosed fallback TTS (non-Rime) — audible, speech-like deterministic tone,
 * used ONLY when Rime is unavailable. The dev panel and logs disclose it.
 */
export function synthFallback(text: string, rateHz = 22050): { audioBase64: string; rateHz: number; disclosed: boolean; reason: string } {
  const float = soundingSamples(text, rateHz, Math.min(12, Math.max(1, text.length / 18)));
  const int16 = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) int16[i] = Math.max(-32768, Math.min(32767, Math.round(float[i] * 32767)));
  return {
    audioBase64: bytesToBase64(new Uint8Array(int16.buffer)),
    rateHz,
    disclosed: true,
    // User-safe label: the Rime provider is unavailable for this reply (the
    // detailed cause is logged server-side only).
    reason: 'Rime is unavailable for this reply — using a basic fallback tone.',
  };
}

/** Minimal Int16→base64 (PCM fits in ~60 KB; DOM `btoa` is available). */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Deterministic audible tone shaped by word boundaries (NOT a real TTS engine). */
function soundingSamples(text: string, rateHz: number, seconds: number): Float64Array {
  const words = text.split(/\s+/).filter(Boolean);
  const n = Math.max(1, Math.floor(rateHz * seconds));
  const out = new Float64Array(n);
  if (words.length === 0) return out;
  let pos = 0;
  for (const word of words) {
    const wordChars = word.length;
    const dur = Math.max(rateHz * 0.1, Math.min(rateHz * 0.5, (wordChars / (text.length || 1)) * n * 0.8));
    const f0 = 150 + (word.length % 5) * 18;
    for (let i = 0; i < dur && pos < n; i++) {
      const t = i / rateHz;
      const attack = Math.min(1, i / (rateHz * 0.02));
      const release = Math.min(1, (dur - i) / (rateHz * 0.02));
      if (attack <= 0 || release <= 0) continue;
      out[pos++] = attack * release * (0.42 * Math.sin(2 * Math.PI * f0 * t) + 0.2 * Math.sin(2 * Math.PI * f0 * 0.503 * t));
    }
    pos += Math.floor(rateHz * 0.03);
  }
  return out;
}