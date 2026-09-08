/**
 * VaaniResolve Agent. Two modes (disclosed in the dev panel):
 *
 *  1. REAL LLM  — Anthropic Claude (model from ANTHROPIC_MODEL, default
 *     claude-sonnet-5-1) with structured tool calling over the commerce tools.
 *  2. DETERMINISTIC fallback — a disclosed rule interpreter that maps speech
 *     to the same tool calls. Real tool execution either way; the fallback
 *     exists so the app is fully functional even with no API key configured.
 *
 * The orchestration loop (server) owns state/generation. The agent here only
 * decides which tool to call and returns a speech sentence.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ConversationManager } from '@vaaniresolve/state';
import { TOOL_DEFINITIONS } from '@vaaniresolve/tools';
import type { ToolAction, AgentDecision, AgentKind } from './types.js';

export const SYSTEM_PROMPT = `You are VaaniResolve, a voice-native commerce support agent for an Indian e-commerce platform (Flipkart/Amazon-like).

Guidelines:
- You assist with order tracking, returns, refunds, replacements, cancellations, delivery, payment status, product info and warranty.
- Keep every spoken answer short, natural and polite — the user hears it through text-to-speech. No markdown, no bullet lists, no URLs.
- Use the availability of tools. When you need order details, call the right tool. The mock catalog includes 'Sony WH-1000XM5 Headphones' (VR-48291), 'MacBook Pro 14"' (VR-11360), 'iPhone 15' (VR-09744 delivered, VR-22901 out for delivery), 'Nike Air Zoom Pegasus 40' (VR-55136), 'Kindle Paperwhite' (VR-77108 delayed), 'Samsung Galaxy S24' (VR-66247), 'JBL Tune 770NC' (VR-88015), 'Nothing Phone 2a' (VR-91523 delivered), 'Moto G84' (VR-33208 cancelled).
- When the user references a product, prefer the order on that product over generic product info if the user is asking about "their" order/delivery.
- DESTRUCTIVE actions (cancel, return, replacement) MUST be proposed first as an intent with a confirmation summary. Never execute them silently. The conversation layer will ask the user to confirm.
- If the user is ambivalent ("actually don't cancel", "wait, I meant X") surface the corrected intent and re-route tool calls accordingly. Entity ambiguity must be re-resolved — never reuse a stale entity.
- If the user changes their mind, do not continue the previous action.

Reply as JSON: {"intent": "...", "tool": "toolName | null", "args": {...}, "speech": "spoken sentence"} — always valid JSON on one line.`;

export interface AgentRuntime {
  conversation: ConversationManager;
  callbacks?: {
    onLlStart?: () => void;
    onTokens?: (chunk: string) => void;
    onToolDecided?: (action: ToolAction) => void;
  };
}

function mapToolToOpenAI(def: (typeof TOOL_DEFINITIONS)[number]): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        def.args.map((a) => [a.name, { type: a.type, description: a.description, ...(a.enum ? { enum: a.enum } : {}) }]),
      ),
      required: def.args.filter((a) => a.required).map((a) => a.name),
    } as Anthropic.Tool.InputSchema,
  };
}

export class Agent {
  private client?: Anthropic;
  readonly kind: AgentKind;

  constructor(private apiKey: string, private model: string) {
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.kind = 'claude';
    } else {
      this.kind = 'deterministic';
    }
  }

  async decide(rt: AgentRuntime, userText: string): Promise<AgentDecision> {
    if (this.kind === 'claude' && this.client) {
      try {
        return await this.decideWithClaude(rt, userText);
      } catch (err) {
        // Disclose fallback on LLM failure so the loop stays live.
        rt.conversation.pushToolSummary('llm', false, `fallback ${err instanceof Error ? err.message : ''}`);
        return decideDeterministic(rt, userText, true);
      }
    }
    return decideDeterministic(rt, userText, false);
  }

  private async decideWithClaude(rt: AgentRuntime, userText: string): Promise<AgentDecision> {
    const client = this.client!;
    rt.callbacks?.onLlStart?.();

    const history = rt.conversation.getHistory();
    const messages: Anthropic.MessageParam[] = [];
    // compact-ish: keep last 12 entries as prompt context
    const tail = history.slice(-12);
    for (const h of tail) {
      if (h.role === 'user') messages.push({ role: 'user', content: h.content });
      else if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.content });
      else messages.push({ role: 'user', content: `[tool observation] ${h.content}` });
    }
    messages.push({ role: 'user', content: userText });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 220,
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOL_DEFINITIONS.map(mapToolToOpenAI),
      temperature: 0.2,
    });

    // Expect a text JSON block; also tolerate tool_use output.
    let text = '';
    for (const b of response.content) {
      if (b.type === 'text') {
        text += b.text;
        rt.callbacks?.onTokens?.(b.text);
      } else if (b.type === 'tool_use') {
        const args = b.input as Record<string, unknown>;
        const decision: AgentDecision = {
          kind: 'claude',
          tool: b.name as string,
          args,
          intent: b.name,
          speech: '',
          llmRaw: text.slice(0, 400),
        };
        return decision;
      }
    }

    return parseDecisionText(text);
  }
}

export function parseDecisionText(text: string): AgentDecision {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      return {
        kind: 'claude',
        tool: obj.tool ?? null,
        args: obj.args ?? {},
        intent: obj.intent ?? '',
        speech: obj.speech ?? '',
      };
    } catch {
      /* fall through to plain speak */
    }
  }
  return { kind: 'claude', tool: null, args: {}, intent: text, speech: text };
}

/**
 * Deterministic (disclosed) intent interpreter — offline fallback.
 * Understands the demo utterances deterministically so the product is fully
 * demonstrable without API keys, while real tool execution still happens.
 */
export function decideDeterministic(rt: AgentRuntime, userText: string, dueToError: boolean): AgentDecision {
  const c = rt.conversation;
  const t = userText.toLowerCase();
  const intent = extractIntent(t);

  const pickOrderByProduct = (productName: string): string | null => {
    // Resolve through the actual tool so sessions share the same data.
    return null; // resoclassubly: rely on tool's own product resolution
  };
  void pickOrderByProduct;

  // Destructive intent -> always confirmation. Explicit product/id references
  // win over context; the active-entity (pronoun) fallback keeps "cancel them"
  // working after a tracked order. A changed mind is separately cleared.
  const targetArgs = resolveOrderArgs(t, c, true);
  if (intent.cancel) {
    return {
      kind: 'deterministic',
      tool: 'cancelOrder',
      args: targetArgs,
      intent: 'cancel',
      speech: '',
      needsConfirmation: true,
      confirmSummary: `Your order will be cancelled and the amount refunded to your original payment method. Shall I go ahead?`,
      dueToError,
    };
  }
  if (intent.returnRequest) {
    return {
      kind: 'deterministic',
      tool: 'requestReturn',
      args: targetArgs,
      intent: 'return',
      speech: '',
      needsConfirmation: true,
      confirmSummary: `A return will be scheduled on your order with a pickup and a refund in about five days. Shall I go ahead?`,
      dueToError,
    };
  }
  if (intent.replacement) {
    return {
      kind: 'deterministic',
      tool: 'requestReplacement',
      args: targetArgs,
      intent: 'replacement',
      speech: '',
      needsConfirmation: true,
      confirmSummary: `A replacement will be ordered for that item and the old unit collected. Shall I go ahead?`,
      dueToError,
    };
  }
  if (intent.cancelPending) {
    c.clearPendingAction();
    return {
      kind: 'deterministic',
      tool: null,
      args: {},
      intent: 'cancel',
      speech: 'No problem, I have cancelled that. Nothing will be changed.',
      dueToError,
    };
  }
  if (intent.refundStatus) {
    return { kind: 'deterministic', tool: 'getRefundStatus', args: resolveOrderArgs(t, c, true), intent: 'refund_status', speech: '', dueToError };
  }
  if (intent.track) {
    return { kind: 'deterministic', tool: 'trackOrder', args: resolveOrderArgs(t, c, true), intent: 'track', speech: '', dueToError };
  }
  if (intent.orders) {
    return { kind: 'deterministic', tool: 'getOrders', args: {}, intent: 'list_orders', speech: '', dueToError };
  }
  if (intent.productInfo) {
    const productName = detectProductName(t);
    return { kind: 'deterministic', tool: 'getProduct', args: { productName }, intent: 'product_info', speech: '', dueToError };
  }
  // Voice shopping — "find a laptop under 70,000", "show me phones",
  // "suggest a laptop for coding". Resolves category + INR budget so the
  // shopping tool returns matching product cards (spoken + on screen).
  if (intent.shopping) {
    const category = detectCategory(t);
    const maxPrice = parseMaxPrice(t);
    return {
      kind: 'deterministic',
      tool: 'findProducts',
      args: { category: category ?? '', query: '', maxPrice: maxPrice ?? undefined },
      intent: 'shopping',
      speech: '',
      dueToError,
    };
  }
  if (intent.payment) {
    return { kind: 'deterministic', tool: 'getPaymentStatus', args: resolveOrderArgs(t, c, true), intent: 'payment', speech: '', dueToError };
  }
  if (intent.warranty) {
    const productName = detectProductName(t);
    return { kind: 'deterministic', tool: 'getWarranty', args: { productName }, intent: 'warranty', speech: '', dueToError };
  }
  if (intent.orderLookup) {
    return { kind: 'deterministic', tool: 'getOrder', args: resolveOrderArgs(t, c, true), intent: 'order_lookup', speech: '', dueToError };
  }
  if (intent.help) {
    return {
      kind: 'deterministic',
      tool: null,
      args: {},
      intent: 'help',
      speech: `I can track orders, look up a product, check payment or refund status, and handle cancellations, returns and replacements. Just tell me what you need.`,
      dueToError,
    };
  }

  // EXPLICIT product reference — re-resolve the RIGHT order (the "my blue
  // headphones, not my laptop" corrections case). Never reuse a stale entity:
  // a fresh product mention always supersedes active-entity context.
  const mentionedProduct = detectProductName(t);
  if (mentionedProduct) {
    return { kind: 'deterministic', tool: 'trackOrder', args: { productName: mentionedProduct, orderId: '' }, intent: 'track', speech: '', dueToError };
  }

  // Fall on the active entity (context continuity).
  const activeProduct = c.getEntity('activeProduct');
  const activeOrder = c.getEntity('activeOrder');
  if (/where|ready|arrive|delivery|shipping|status/.test(t) && activeOrder) {
    return { kind: 'deterministic', tool: 'trackOrder', args: { orderId: activeOrder.orderId }, intent: 'track', speech: '', dueToError };
  }
  if (activeProduct) {
    return { kind: 'deterministic', tool: 'getProduct', args: { productName: activeProduct.name }, intent: 'product_info', speech: '', dueToError };
  }
  return {
    kind: 'deterministic',
    tool: null,
    args: {},
    intent: 'general',
    speech: `I can help with orders, tracking, returns, refunds, replacements and product info. What would you like to do?`,
    dueToError,
  };
}

function extractIntent(t: string): Record<string, boolean> {
  return {
    cancel: /\b(cancel|cancelled|cancel it|kill the order)/.test(t) && !/don't cancel|do not cancel|actually don't/.test(t),
    cancelPending: /don't cancel|do not cancel|actually don't|scratch that|never mind|stop that/.test(t),
    returnRequest: /\b(return|return it|send it back|need to return)\b/.test(t) && !/return\b.*(?:policy|window)/.test(t),
    replacement: /\breplace|replacement|replace it|new unit|defective\b/.test(t),
    refundStatus: /\brefund|money back|reimburse|payment back\b/.test(t),
    track: /\b(where is|when (will|does)|arrive|delivery|deliver|shipping|shipped|out for delivery|status of)\b/.test(t),
    orders: /\b(orders|my orders|list (my )?orders|all orders|recent orders|order history)\b/.test(t),
    orderLookup: /\b(order|my order|find my order|that order|the order)\b/.test(t),
    productInfo: /\b(product|specs|specifications|tell me about|price|cost|how much|features|does it have)\b/.test(t),
    shopping: isShoppingQuery(t),
    payment: /\b(pay|payment|paid|charge|bill)\b/.test(t),
    warranty: /\b(warranty|guarantee|covered|claim)\b/.test(t),
    help: /\b(help|what can you|options|how do i)\b/.test(t),
  };
}

/** Voice-shopping heuristic: category/price + a shopping verb, but never a
 *  support/order intent (those are matched by earlier rules). */
function isShoppingQuery(t: string): boolean {
  const hasCategory = /(laptop|headphone|headset|earbud|phones?|mobiles?|smartphone|smartwatch|\bwatch\b|shoes?|sneaker|kindle|earbuds|tablet)/.test(t);
  const hasPrice = /(under|below|within|budget|up to|max)\s*[₹rs.]*\s*\d|\d+\s*(k|thousand)|affordable|cheap/.test(t);
  const hasVerb = /(find|search|show (me )?|suggest|recommend|buy|get me|looking for|want|need)/.test(t);
  const isSupport = /(refund|return|cancel|order|track|delivery|warranty|payment|where is my|where are my|status)/.test(t);
  const strong = (hasCategory && hasPrice) || (hasCategory && hasVerb) || (hasVerb && hasPrice);
  return strong && !isSupport;
}

/** Resolve a product category keyword to the catalog category label. */
function detectCategory(t: string): string | null {
  if (/laptop|macbook|ideapad|vivobook/.test(t)) return 'laptop';
  if (/headphone|headset|earbud|earphone|airpods|jbl|sennheiser/.test(t)) return 'headphones';
  if (/phones?\b|mobiles?\b|iphone|smartphone|samsung|oneplus|nothing\s+phone|moto|galaxy/.test(t)) return 'phone';
  if (/smartwatch|\bwatch\b/.test(t)) return 'smartwatch';
  if (/shoes?|sneaker|pegasus/.test(t)) return 'shoes';
  if (/kindle|ebook|e-?reader|\bbooks?\b/.test(t)) return 'e-reader';
  if (/tablet|\biPad\b/.test(t)) return 'tablet';
  return null;
}

/** Parse an INR budget like "under 70,000" / "below 3000" / "under 70k". */
function parseMaxPrice(t: string): number | null {
  const m = t.match(/(?:under|below|within|budget of|up to|max\s*)\s*[₹rs.]*\s*([\d,]+)/i);
  if (!m) {
    const k = t.match(/under\s+(\d+)\s*k/i);
    if (k) return Number(k[1]) * 1000;
    return null;
  }
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function detectProductName(t: string): string {
  const map: Record<string, string> = {
    'samsung': 'Samsung Galaxy S24',
    's24': 'Samsung Galaxy S24',
    'galaxy s24': 'Samsung Galaxy S24',
    'oneplus': 'OnePlus 12R',
    '12r': 'OnePlus 12R',
    'airpods': 'Apple AirPods Pro 2',
    'jbl': 'JBL Tune 770NC',
    'sennheiser': 'Sennheiser Accentum Wireless',
    'accentum': 'Sennheiser Accentum Wireless',
    'nothing phone': 'Nothing Phone (2a)',
    'moto': 'Moto G84',
    'g84': 'Moto G84',
    'ipad': 'iPad (10th generation)',
    'tablet': 'iPad (10th generation)',
    'headphone': 'Sony WH-1000XM5 Headphones',
    'sony': 'Sony WH-1000XM5 Headphones',
    'xm5': 'Sony WH-1000XM5 Headphones',
    'laptop': 'MacBook Pro 14"',
    'macbook': 'MacBook Pro 14"',
    'macbook pro': 'MacBook Pro 14"',
    'phone': 'iPhone 15',
    'iphone': 'iPhone 15',
    'smartwatch': 'Samsung Galaxy Watch 6',
    'galaxy watch': 'Samsung Galaxy Watch 6',
    'watch': 'Samsung Galaxy Watch 6',
    'shoe': 'Nike Air Zoom Pegasus 40',
    'nike': 'Nike Air Zoom Pegasus 40',
    'pegasus': 'Nike Air Zoom Pegasus 40',
    'pegasus 40': 'Nike Air Zoom Pegasus 40',
    'kindle': 'Kindle Paperwhite',
    'ebook': 'Kindle Paperwhite',
  };
  for (const [key, name] of Object.entries(map)) {
    if (t.includes(key)) return name;
  }
  return '';
}

/**
 * Best-effort resolution of "which order" to a tool arg set.
 * - Explicit VR-xxxxx id wins.
 * - If a purchased product is named, prefer (productName) so the tool resolves
 *   the RIGHT order — this is exactly the "blue headphones, not laptop" case.
 * - Otherwise fall back to the active order for context continuity.
 */
function resolveOrderArgs(t: string, c: ConversationManager, allowActive = false): Record<string, string> {
  const id = t.match(/VR[- ]?\d{5}/i);
  if (id) {
    // Normalize any of VR-77108 / VR 77108 / VR77108 to the canonical VR-77108.
    // Never strip the dash — the mock catalog's order ids are VR-XXXXX.
    const digits = id[0].replace(/[^0-9]/g, '');
    return { orderId: `VR-${digits}` };
  }

  const product = detectProductName(t);
  if (product) return { productName: product, orderId: '' };

  if (allowActive) {
    const active = c.getEntity('activeOrder');
    if (active) return { orderId: active.orderId };
  }
  return { orderId: '' };
}