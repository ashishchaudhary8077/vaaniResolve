/**
 * @vaaniresolve/state — AUTHORITATIVE PUBLIC CONTRACT (declaration only).
 *
 * Pins the full public surface: ConversationManager class (public shape)
 * and the ConversationContextSnapshot type. Cross-package types (ConversationState,
 * Order, Product, ConfirmationRequired) are imported from the shared contract.
 */

import type {
  ConfirmationRequired,
  ConversationState,
  Order,
  Product,
} from '@vaaniresolve/shared';

/* -------------------------------------------------------------- internal */

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

/* -------------------------------------------------------------- snapshot */

export interface ConversationContextSnapshot {
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string;
  state: ConversationState;
  entities: TrackedEntities;
}

/* ----------------------------------------------------------- manager */

export class ConversationManager {
  readonly sessionId: string;
  turnId: number;
  generation: number;
  state: ConversationState;

  constructor(sessionId?: string);

  newRequestId(): string;
  nextTurn(): { turnId: number; generation: number; requestId: string };
  interrupt(): { turnId: number; generation: number };
  resumeFromInterrupt(): void;
  isCurrent(ctx: { sessionId?: string; generation?: number; turnId?: number }): boolean;
  markStaleIfNeeded(generation: number): boolean;
  setState(next: ConversationState): ConversationState;
  getState(): ConversationState;

  pushUser(text: string): void;
  pushAssistant(text: string): void;
  pushToolSummary(tool: string, ok: boolean, note?: string): void;
  getHistory(): { role: 'user' | 'assistant' | 'tool'; content: string }[];

  setSummary(summary: string): void;
  getSummary(): string;

  setEntity<K extends keyof TrackedEntities>(key: K, value: TrackedEntities[K]): void;
  getEntity<K extends keyof TrackedEntities>(key: K): TrackedEntities[K] | undefined;

  snapshot(): ConversationContextSnapshot;

  setPendingAction(action: PendingAction): void;
  getPendingAction(): PendingAction | undefined;
  clearPendingAction(): void;

  isStatement(text: string): boolean;
}