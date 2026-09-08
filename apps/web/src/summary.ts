/**
 * Build a Customer-Care summary from the CURRENT conversation state — never
 * hardcoded. Pure function over transcripts + cards so the panel can derive
 * fresh fields on demand (edit/refresh) and the representative sees exactly
 * what the customer already explained.
 */

import type { CareSummary, ResolutionCard } from '@vaaniresolve/shared';
import type { TranscriptItem } from './useVaani';

const ORDER_ID_RE = /VR[- ]?(\d{5})/i;

function lastMeaningfulUser(items: TranscriptItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const t = items[i];
    if (t.role !== 'user') continue;
    const text = t.text.trim();
    if (!text) continue;
    // Skip trivial acknowledgements (the real ask is elsewhere).
    if (/^(yes|no|ok|okay|yeah|yep|sure|go ahead|thanks|thank you|alright|fine)[.!?,]*$/i.test(text)) continue;
    return text;
  }
  return '';
}

function classifyMainProblem(ask: string): string {
  const t = ask.toLowerCase();
  if (/\breturn\b/.test(t)) return 'Return / pickup request';
  if (/\b(refund|money back|reimburse)\b/.test(t)) return 'Refund status enquiry';
  if (/\bcancel/.test(t)) return 'Order cancellation';
  if (/\b(replace|defective)\b/.test(t)) return 'Replacement for defective item';
  if (/\b(where is|when.*arrive|delivery|status of|track)\b/.test(t)) return 'Order tracking & delivery';
  if (/\b(under|budget|find|show me|suggest).*(laptop|headphone|phone|watch|shoes|kindle)/.test(t)) return 'Shopping assistance';
  if (/\b(pay|paid|charge|bill)\b/.test(t)) return 'Payment status enquiry';
  if (/\b(warranty|guarantee)\b/.test(t)) return 'Warranty enquiry';
  if (/\b(product|specs|price|cost|how much)\b/.test(t)) return 'Product information';
  return 'General support';
}

function detectActions(items: TranscriptItem[]): string[] {
  const actions: string[] = [];
  const t = items.map((i) => (i.role === 'assistant' ? i.text : i.role === 'tool' ? i.text : '')).join('\n');
  const has = (re: RegExp, label: string) => {
    if (re.test(t) && !actions.includes(label)) actions.push(label);
  };
  has(/\bcancelled\b/i, 'Order cancellation requested');
  has(/\breturn (requested|will be scheduled|scheduled)\b/i, 'Return requested with pickup');
  has(/\breplacement will be ordered\b/i, 'Replacement ordered');
  has(/\brefund (initiated|status|processing|completed)/i, 'Refund status checked');
  has(/tracking (update|status)|out for delivery|arrives? on/i, 'Order tracked');
  has(/found \d+ products|shopping|matching products|under ₹/i, 'Shopped the catalog');
  return actions;
}

function detectEntities(items: TranscriptItem[]): string[] {
  const out: string[] = [];
  const idSet = new Set<string>();
  const prodSet = new Set<string>();
  const seen = (s: string) => out.includes(s);
  for (const it of items) {
    const text = it.text;
    const ids = text.match(/VR[- ]?(\d{5})/gi) ?? [];
    for (const raw of ids) {
      const digits = raw.replace(/[^0-9]/g, '');
      const norm = `VR-${digits}`;
      if (!idSet.has(norm)) {
        idSet.add(norm);
        out.push(`Order ${norm}`);
      }
    }
    const prods = text.match(/MacBook Pro|Sony WH-1000XM5|iPhone \d+|Samsung Galaxy Watch|Nike Air Zoom|Kindle Paperwhite|Lenovo IdeaPad|ASUS Vivobook|boAt Rockerz|Redmi Note \d+/gi) ?? [];
    for (const p of prods) {
      const norm = p.replace(/\b(a|an|the)\b/gi, '').trim();
      if (!prodSet.has(norm)) {
        prodSet.add(norm);
        out.push(`Product: ${norm}`);
      }
    }
  }
  void seen;
  return out.slice(0, 6);
}

function lastAssistantState(items: TranscriptItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const t = items[i];
    if (t.role !== 'assistant') continue;
    if (/\breturn\b/i.test(t.text)) return 'Return action proposed/done — awaiting customer decision on pickup.';
    if (/\bcancelled\b/i.test(t.text) && /nothing will be changed|i have cancelled/i.test(t.text)) return 'Cancellation declined by customer.';
    if (/replacement/i.test(t.text)) return 'Replacement in progress.';
    if (/\b(₹|rs\.?|rupees)\s*\d/i.test(t.text)) return 'Shopping results shown — awaiting product choice.';
    if (/\barrives\b|\bdelivered\b|\bout for delivery\b/i.test(t.text)) return 'Delivery status shared.';
    return 'Assistant responded with the latest result.';
  }
  return 'Conversation in progress.';
}

/** Next step the representative should take given the live state. */
function recommendNextStep(items: TranscriptItem[], acts: string[], cards: ResolutionCard[]): string {
  const pendingConf = items.some((i) => i.role === 'system' && /confirm/i.test(i.text));
  if (pendingConf) return 'Customer has a pending confirmation — ask them to decide before proceeding.';
  if (cards.some((c) => c.kind === 'shopping')) {
    const lastAsk = lastMeaningfulUser(items);
    return /under|budget/i.test(lastAsk.toLowerCase())
      ? 'Review the shortlisted products with the customer and take the order.'
      : 'Help the customer pick from the shown products and place the order.';
  }
  if (acts.some((a) => /return|refund|replacement|cancel/i.test(a))) return 'Close the loop: confirm refund ETA / pickup slot and gather feedback.';
  const lastAsk = lastMeaningfulUser(items);
  if (/laptop|headphone|phone|watch/i.test(lastAsk.toLowerCase())) return 'Walk the customer to a purchase match and complete checkout.';
  return 'Continue assisting: re-verify order/status with the customer and confirm resolution.';
}

export function buildCareSummary({
  transcripts,
  cards,
}: {
  transcripts: TranscriptItem[];
  cards: ResolutionCard[];
}): CareSummary {
  const ask = lastMeaningfulUser(transcripts);
  const actions = detectActions(transcripts);
  const entities = detectEntities(transcripts);
  const userLines = transcripts
    .filter((t) => t.role === 'user' && t.text.trim())
    .slice(-5)
    .map((t) => t.text.trim());

  const mainProblem = ask ? classifyMainProblem(ask) : 'General customer-care enquiry';
  const convo = userLines.length
    ? `Customer asked: ${userLines.join(' → ')}`
    : 'Customer opened the conversation but has not described an issue yet.';

  return {
    mainProblem,
    conversationSummary: convo.slice(0, 600),
    importantDetails: entities,
    actionsAlreadyTaken: actions,
    orderShoppingContext: entities.filter((e) => e.startsWith('Order') || e.startsWith('Product')),
    currentStatus: lastAssistantState(transcripts),
    recommendedNextStep: recommendNextStep(transcripts, actions, cards),
    customerLastAsked: ask || undefined,
  };
}