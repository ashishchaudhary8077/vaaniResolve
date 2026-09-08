/**
 * VaaniResolve server entry — Express REST + WebSocket realtime.
 *
 * The server owns one ConversationEngine per connection and is the single
 * source of truth for generation/state. Secrets live ONLY on the server
 * (RIME_API_KEY, ANTHROPIC_API_KEY) and are never sent to the browser.
 */

import './loadEnv.js';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { ConversationManager } from '@vaaniresolve/state';
import { Agent } from '@vaaniresolve/agent';
import { loadRimeConfig } from '@vaaniresolve/rime';
import type { RimeConfig } from '@vaaniresolve/rime';
import { TOOL_DEFINITIONS } from '@vaaniresolve/tools';
import type { WireMessage, ConfirmationAnswer, ClientUserSpeech } from '@vaaniresolve/shared';
import { ConversationEngine } from './engine.js';
import { Metrics } from './metrics.js';
import { storeHandoff, latestHandoff, listHandoffs, updateHandoffStatus } from './care.js';
import type { CareHandoffRequest } from '@vaaniresolve/shared';

const PORT = Number(process.env.PORT ?? 8787);

export const rimeConfig: RimeConfig = loadRimeConfig(process.env);
export const agentKind = (process.env.ANTHROPIC_API_KEY ? 'claude' : 'deterministic') as 'claude' | 'deterministic';

export interface EngineBundle {
  engine: ConversationEngine;
  metrics: Metrics;
  conversation: ConversationManager;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'vaaniresolve', time: Date.now(), rime: rimeConfig.apiKey ? 'configured' : 'unconfigured', agent: agentKind });
});

app.get('/api/tools', (_req, res) => {
  res.json({ tools: TOOL_DEFINITIONS.map((d) => ({ name: d.name, description: d.description, destructive: !!d.destructive, domain: d.domain })) });
});

app.get('/api/status', (_req, res) => {
  res.json({ rime: { model: rimeConfig.model, speaker: rimeConfig.speaker, language: rimeConfig.language, endpoint: rimeConfig.endpoint, configured: !!rimeConfig.apiKey }, agent: agentKind });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
let latestMetrics: Metrics | null = null;

function send(ws: WebSocket, msg: Omit<WireMessage, 'ts'>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...msg, ts: Date.now() }));
}

app.get('/api/metrics', (_req, res) => {
  res.json(latestMetrics?.snapshot() ?? { events: [], latencies: [], interruptCount: 0, cancelledRequests: 0, staleResultsDiscarded: 0, generationBumps: 0 });
});

/* ------------------------------------------------------------ customer care */

/**
 * Handoff endpoint — the customer-care panel POSTs the live conversation
 * summary so a representative sees it without the customer repeating anything.
 * No conversations/keys are logged; the summary is sanitized before storage.
 */
app.post('/api/care/handoff', (req, res) => {
  const body = (req.body ?? {}) as Partial<CareHandoffRequest>;
  if (!body.summary || typeof body.summary !== 'object') {
    res.status(400).json({ ok: false, error: 'A conversation summary is required.' });
    return;
  }
  const handoff = storeHandoff({
    sessionId: body.sessionId ?? '',
    customerName: body.customerName,
    summary: body.summary,
  });
  console.log(`[care] handoff ${handoff.handoffId} received (${handoff.summary.mainProblem.slice(0, 60)})`);
  res.json({ ok: true, handoffId: handoff.handoffId, receivedAt: handoff.receivedAt });
});

app.get('/api/care/latest', (_req, res) => {
  const h = latestHandoff();
  res.json({ ok: true, handoff: h });
});

app.get('/api/care/handoffs', (_req, res) => {
  res.json({ ok: true, handoffs: listHandoffs() });
});

app.patch('/api/care/handoffs/:id', (req, res) => {
  const status = String(req.body?.status ?? '');
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
    res.status(400).json({ ok: false, error: 'Invalid status.' });
    return;
  }
  const h = updateHandoffStatus(String(req.params.id), status as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED');
  if (!h) {
    res.status(404).json({ ok: false, error: 'Handoff not found.' });
    return;
  }
  res.json({ ok: true, handoff: h });
});

function makeBundle(): EngineBundle {
  const conversation = new ConversationManager();
  const metrics = new Metrics();
  const agent = new Agent(process.env.ANTHROPIC_API_KEY ?? '', process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-1');
  const bundle: EngineBundle = { engine: undefined as never, metrics, conversation };
  let wsRef: WebSocket | undefined;
  bundle.engine = new ConversationEngine({
    conversation,
    agent,
    rimeConfig,
    metrics,
    toolOverrides: { seed: Number(process.env.TOOL_SEED ?? 42), latency: process.env.TOOL_LATENCY ? safeLatencyMap(process.env.TOOL_LATENCY) : undefined, fail: process.env.TOOL_FAIL ? process.env.TOOL_FAIL.split(',') : undefined },
    events: {
      send: (msg) => {
        if (wsRef) send(wsRef, msg);
      },
    },
  });
  latestMetrics = metrics;
  Object.assign(bundle, { setWs: (ws: WebSocket) => { wsRef = ws; } });
  return bundle;
}

function safeLatencyMap(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [tool, ms] = pair.split('=');
    if (tool && ms) out[tool.trim()] = Math.max(0, Number(ms));
  }
  return out;
}

wss.on('connection', (ws) => {
  const bundle = makeBundle();
  (bundle as unknown as { setWs: (w: WebSocket) => void }).setWs(ws);
  const { engine, metrics, conversation } = bundle;

  send(ws, {
    type: 'hello',
    sessionId: conversation.sessionId,
    turnId: conversation.turnId,
    generation: conversation.generation,
    requestId: conversation.newRequestId(),
    payload: {
      rime: { provider: 'rime', model: rimeConfig.model, speaker: rimeConfig.speaker, language: rimeConfig.language, endpoint: rimeConfig.endpoint, configured: !!rimeConfig.apiKey },
      agent: agentKind,
      tools: TOOL_DEFINITIONS.map((d) => d.name),
    },
  });

  ws.on('message', (raw: RawData) => {
    let msg: WireMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', sessionId: conversation.sessionId, turnId: conversation.turnId, generation: conversation.generation, requestId: '', payload: { code: 'BAD_JSON', message: 'Invalid JSON' } });
      return;
    }

    switch (msg.type) {
      case 'user_speech_end': {
        const p = msg.payload as ClientUserSpeech;
        metrics.log({ event: 'USER_SPEECH_END', sessionId: conversation.sessionId, turnId: conversation.turnId, generation: conversation.generation, requestId: msg.requestId || conversation.newRequestId(), detail: `utterance len=${p.transcript.length}` });
        void engine.handleUserSpeech({ transcript: p.transcript, speechEndedAt: p.speechEndedAt, requestId: msg.requestId || undefined });
        break;
      }
      case 'user_interrupt':
        engine.interrupt();
        break;
      case 'confirmation_result': {
        void engine.handleConfirmation(msg.payload as ConfirmationAnswer);
        break;
      }
      case 'user_speech_start': {
        metrics.log({ event: 'USER_SPEECH_START', sessionId: conversation.sessionId, turnId: conversation.turnId, generation: conversation.generation, requestId: msg.requestId || '', detail: 'barge-in start' });
        break;
      }
      default: {
        send(ws, { type: 'error', sessionId: conversation.sessionId, turnId: conversation.turnId, generation: conversation.generation, requestId: msg.requestId || '', payload: { code: 'UNKNOWN', message: `Unhandled message type ${msg.type}` } });
      }
    }
  });

  ws.on('close', () => {
    engine.interrupt();
  });
});

// Surface startup failures (notably EADDRINUSE from a port clash) with a clear,
// actionable message instead of an opaque uncaught exception. Must be attached
// BEFORE listen(): a synchronous bind failure emits 'error' before the listen
// callback runs, so a late handler would never see it.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[vaaniresolve] FATAL: port ${PORT} is already in use by another process. Change PORT in the repo-root .env (or free :${PORT} and stop the other process), then restart.`);
  } else {
    console.error('[vaaniresolve] server failed to start:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[vaaniresolve] server listening on http://localhost:${PORT}  rime=${rimeConfig.apiKey ? 'configured' : 'unconfigured'} agent=${agentKind}`);
});

// The dev server (tsx --watch) restarts this file on change; re-registering the
// error handler above for each boot is fine because the process exits on error.