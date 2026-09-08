/**
 * VaaniResolve realtime protocol — events flowing between the client and the
 * server over WebSocket, and structured observability events (spec section 11).
 *
 * Every async operation carries (sessionId, turnId, generation, requestId) so
 * stale results can be rejected (spec section 4).
 */

import type {
  ConversationState,
  ConfirmationRequired,
  ResolutionCard,
  ToolResult,
} from './types.js';

export type ProtocolEventName =
  | 'hello'
  | 'user_speech_start'
  | 'user_speech_end'
  | 'llm_start'
  | 'llm_tokens'
  | 'tool_start'
  | 'tool_complete'
  | 'tool_stale'
  | 'user_interrupt'
  | 'generation_invalidated'
  | 'generation_bump'
  | 'confirmation_required'
  | 'confirmation_result'
  | 'state_change'
  | 'assistant_text'
  | 'rime_start'
  | 'rime_first_audio'
  | 'rime_chunk'
  | 'rime_stop'
  | 'speech_finished'
  | 'stale_result_discarded'
  | 'resolution'
  | 'response_complete'
  | 'error'
  | 'metrics';

/** Wire envelope for every client<->server message. */
export interface WireMessage {
  type: ProtocolEventName;
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string;
  ts: number;
  payload?: unknown;
}

export interface SessionContext {
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string;
}

export interface ClientHello {
  sessionId?: string; // resume
  user?: { name?: string };
}

export interface ClientUserSpeech {
  transcript: string;
  final?: boolean;
  /** absolute ms epoch when user stopped speaking (T0) */
  speechEndedAt?: number;
}

export interface ServerMetrics {
  sttMs?: number;
  llmMs?: number;
  rimeRequestMs?: number;
  rimeFirstAudioMs?: number;
  ttfaMs?: number;
  toolLatencyMs?: number;
  interruptCount: number;
  cancelledRequests: number;
  staleResultsDiscarded: number;
  currentState: ConversationState;
  rimeConfig: {
    provider: string;
    model: string;
    speaker: string;
    language: string;
    endpoint: string;
  };
}

export interface AssistantPayload {
  text?: string;
  cards?: ResolutionCard[];
}

export interface ConfirmationPayload extends ConfirmationRequired {}

export interface ConfirmationAnswer {
  confirmationId: string;
  accepted: boolean;
  note?: string;
}

export interface ToolEventPayload {
  tool: string;
  status: 'start' | 'complete' | 'stale' | 'cancel';
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ResolutionPayload {
  payload: ResolutionCard | ResolutionCard[];
}
