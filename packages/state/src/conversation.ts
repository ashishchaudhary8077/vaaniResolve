/**
 * ConversationManager — the explicit state machine + generation tracker.
 *
 * Invariant (spec section 4 & 5):
 *   NO OBSOLETE GENERATION MAY EVER BE SPOKEN.
 *
 * Every user turn bumps `generation`. Every async operation is stamped with
 * (sessionId, turnId, generation, requestId). A result whose generation no
 * longer matches `this.generation` is STALE and must be discarded by callers.
 */

import type {
  ConfirmationRequired,
  ConversationState,
  Order,
  Product,
} from '@vaaniresolve/shared';

interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  confirmationId: string;
  orderId?: string;
}

interface TrackedEntities {
  activeOrder?: Order;
  activeProduct?: Product;
  activeIssue?: string;
  requestedAction?: string;
  lastConfirmedEntity?: string;
}

export interface ConversationContextSnapshot {
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string;
  state: ConversationState;
  entities: TrackedEntities;
}

export class ConversationManager {
  readonly sessionId: string;
  turnId = 1;
  generation = 1;
  private requestCounter = 0;
  state: ConversationState = 'IDLE';
  private history: { role: 'user' | 'assistant' | 'tool'; content: string }[] = [];
  private entities: TrackedEntities = {};
  private pendingAction?: PendingAction;
  private interrupted = false;
  private summary = '';

  constructor(sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`) {
    this.sessionId = sessionId;
  }

  /** Claim a new request id for the CURRENT generation. */
  newRequestId(): string {
    this.requestCounter += 1;
    return `r${this.turnId}g${this.generation}c${this.requestCounter}`;
  }

  nextTurn(): { turnId: number; generation: number; requestId: string } {
    this.turnId += 1;
    return {
      turnId: this.turnId,
      generation: this.generation,
      requestId: this.newRequestId(),
    };
  }

  /** A user interruption: bump generation immediately, mark all prior work stale. */
  interrupt(): { turnId: number; generation: number } {
    this.interrupted = true;
    this.generation += 1;
    const next = { turnId: this.turnId + 1, generation: this.generation };
    this.turnId = next.turnId;
    this.setState('INTERRUPTED');
    this.clearPendingAction(); // a changed mind must NOT execute a pending destructive action
    return next;
  }

  resumeFromInterrupt(): void {
    this.interrupted = false;
    if (this.state === 'INTERRUPTED') this.setState('IDLE');
  }

  isCurrent(ctx: { sessionId?: string; generation?: number; turnId?: number }): boolean {
    if (ctx.sessionId && ctx.sessionId !== this.sessionId) return false;
    if (ctx.generation !== undefined && ctx.generation !== this.generation) return false;
    return true;
  }

  markStaleIfNeeded(generation: number): boolean {
    if (generation !== this.generation) {
      return true; // caller should log STALE_RESULT_DISCARDED
    }
    return false;
  }

  setState(next: ConversationState): ConversationState {
    this.state = next;
    return next;
  }

  getState(): ConversationState {
    return this.state;
  }

  pushUser(text: string): void {
    this.history.push({ role: 'user', content: text });
  }

  pushAssistant(text: string): void {
    this.history.push({ role: 'assistant', content: text });
  }

  pushToolSummary(tool: string, ok: boolean, note?: string): void {
    this.history.push({
      role: 'tool',
      content: `tool:${tool} ok=${ok}${note ? ` ${note}` : ''}`,
    });
  }

  getHistory(): { role: 'user' | 'assistant' | 'tool'; content: string }[] {
    return this.history;
  }

  setSummary(summary: string): void {
    this.summary = summary;
  }

  getSummary(): string {
    return this.summary;
  }

  // ---- entity tracking (active product/order/issue) ---------------------

  setEntity<K extends keyof TrackedEntities>(key: K, value: TrackedEntities[K]): void {
    this.entities[key] = value;
  }

  getEntity<K extends keyof TrackedEntities>(key: K): TrackedEntities[K] | undefined {
    return this.entities[key];
  }

  snapshot(): ConversationContextSnapshot {
    return {
      sessionId: this.sessionId,
      turnId: this.turnId,
      generation: this.generation,
      requestId: this.newRequestId(),
      state: this.state,
      entities: { ...this.entities },
    };
  }

  // ---- pending (destructive) action with confirmation --------------------

  setPendingAction(action: PendingAction): void {
    this.pendingAction = action;
    this.setState('WAITING_CONFIRMATION');
  }

  getPendingAction(): PendingAction | undefined {
    return this.pendingAction;
  }

  clearPendingAction(): void {
    this.pendingAction = undefined;
  }

  isStatement(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (t.length < 2) return false;
    return !/^(what|where|when|who|which|why|how|is|are|can|could|would|will|do|does|did|tell|show|explain|please)/.test(t);
  }
}