/**
 * @vaaniresolve/agent — AUTHORITATIVE PUBLIC CONTRACT (declaration only).
 *
 * Pins: Agent class, decideDeterministic, parseDecisionText, SYSTEM_PROMPT,
 * and the AgentDecision/AgentKind/ToolAction types. AgentRuntime is declared
 * (non-exported) so function signatures can reference it without leaking it
 * into the consumer's type surface — it is NOT re-exported by the barrel.
 */

import type { ConversationManager } from '@vaaniresolve/state';

/* --------------------------------------------------------- AgentRuntime (internal) */

interface AgentRuntime {
  conversation: ConversationManager;
  callbacks?: {
    onLlStart?: () => void;
    onTokens?: (chunk: string) => void;
    onToolDecided?: (action: ToolAction) => void;
  };
}

/* -------------------------------------------------------------- types */

export type AgentKind = 'claude' | 'deterministic';

export interface ToolAction {
  tool: string | null;
  args: Record<string, unknown>;
}

export interface AgentDecision {
  kind: AgentKind;
  tool: string | null;
  args: Record<string, unknown>;
  intent: string;
  speech: string;
  needsConfirmation?: boolean;
  confirmSummary?: string;
  dueToError?: boolean;
  llmRaw?: string;
}

/* ------------------------------------------------------------ values */

/** Pinned exact literal of the implementation SYSTEM_PROMPT. */
export const SYSTEM_PROMPT: `You are VaaniResolve, a voice-native commerce support agent for an Indian e-commerce platform (Flipkart/Amazon-like).

Guidelines:
- You assist with order tracking, returns, refunds, replacements, cancellations, delivery, payment status, product info and warranty.
- Keep every spoken answer short, natural and polite — the user hears it through text-to-speech. No markdown, no bullet lists, no URLs.
- Use the availability of tools. When you need order details, call the right tool. The mock catalog includes 'Sony WH-1000XM5 Headphones' (VR-48291), 'MacBook Pro 14"' (VR-11360), 'iPhone 15' (VR-09744 delivered, VR-22901 out for delivery), 'Nike Air Zoom Pegasus 40' (VR-55136), 'Kindle Paperwhite' (VR-77108 delayed), 'Samsung Galaxy S24' (VR-66247), 'JBL Tune 770NC' (VR-88015), 'Nothing Phone 2a' (VR-91523 delivered), 'Moto G84' (VR-33208 cancelled).
- When the user references a product, prefer the order on that product over generic product info if the user is asking about "their" order/delivery.
- DESTRUCTIVE actions (cancel, return, replacement) MUST be proposed first as an intent with a confirmation summary. Never execute them silently. The conversation layer will ask the user to confirm.
- If the user is ambivalent ("actually don't cancel", "wait, I meant X") surface the corrected intent and re-route tool calls accordingly. Entity ambiguity must be re-resolved — never reuse a stale entity.
- If the user changes their mind, do not continue the previous action.

Reply as JSON: {"intent": "...", "tool": "toolName | null", "args": {...}, "speech": "spoken sentence"} — always valid JSON on one line.`;

export class Agent {
  readonly kind: AgentKind;
  constructor(apiKey: string, model: string);
  decide(rt: AgentRuntime, userText: string): Promise<AgentDecision>;
}

export function decideDeterministic(
  rt: AgentRuntime,
  userText: string,
  dueToError: boolean,
): AgentDecision;

export function parseDecisionText(text: string): AgentDecision;