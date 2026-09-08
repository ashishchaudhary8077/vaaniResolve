/**
 * Speech formatter (spec section 6). Turns structured/verbose agent output into
 * concise, natural, spoken-language sentences for Rime. No markdown, no tables,
 * no URLs, numbers spoken as words, under ~2 lines.
 */

import type { Order, Product, ToolResult } from '@vaaniresolve/shared';

export function speakNumber(n: number): string {
  const text = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  return text.replace('US$', '$');
}

/** Indian-rupee price as spoken text, e.g. ₹70,000 (en-IN grouping). */
export function speakInr(n: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(Math.max(0, Math.round(n)))}`;
}

/** Spoken summary of a shopping result — concise, listable, spoken aloud. */
export function formatShoppingSpeech(data: { matches: { name: string; priceInr: number; brand: string }[]; total: number; category?: string; maxPrice?: number }): string {
  const all = data.matches ?? [];
  if (all.length === 0) {
    const budget = data.maxPrice !== undefined ? ` under ${speakInr(data.maxPrice)}` : '';
    return `I could not find${budget} in stock right now. Would you like me to suggest something similar?`;
  }
  const lead =
    data.category && data.maxPrice !== undefined
      ? `I found ${data.total} ${data.category} within ${speakInr(data.maxPrice)}`
      : data.category
        ? `Here are ${data.total} ${data.category}`
        : `I found ${data.total} matching products`;
  const items = all.slice(0, 3).map((p) => `${p.name}, ${speakInr(p.priceInr)}`);
  const tail = all.length > 3 ? `. And ${all.length - 3} more.` : '.';
  return `${lead}. ${items.join('. ')}${tail} Would you like more details on any of them?`;
}

export function statusToSpeech(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

export function formatOrderForSpeech(order: Order, verb = 'is'): string {
  const item = order.items[0];
  const name = item?.name ?? 'your order';
  const count = order.items.length > 1 ? ` and ${order.items.length - 1} more item${order.items.length > 2 ? 's' : ''}` : '';
  let delivery = '';
  if (order.status === 'OUT_FOR_DELIVERY') delivery = ` It is out for delivery${order.expectedDelivery ? ` and expected ${order.expectedDelivery.toLowerCase()}` : ''}.`;
  else if (order.status === 'SHIPPED') delivery = ` It is ${order.expectedDelivery ? `expected ${order.expectedDelivery.toLowerCase()}` : 'on its way'}.`;
  else if (order.status === 'DELAYED') delivery = ` It is delayed. ${order.currentLocation ?? 'The carrier has not given a new date yet'}.`;
  else if (order.status === 'DELIVERED') delivery = ` It was delivered${order.deliveredAt ? ` on ${formatDateSpeech(order.deliveredAt)}` : ''}.`;
  else if (order.status === 'CANCELLED') delivery = ' It has been cancelled.';
  return `${name}${count}, order ${order.orderId}, ${verb} ${statusToSpeech(order.status)}.${delivery}`;
}

/** trackOrder / getDeliveryEstimate return partial order info (no items). */
export function formatTrackResult(
  data: { orderId: string; itemName?: string; status?: string; carrier?: string; currentLocation?: string; expectedDelivery?: string; deliveredAt?: string },
  verb = 'is',
): string {
  const name = data.itemName ?? 'your order';
  let delivery = '';
  if (data.status === 'OUT_FOR_DELIVERY') delivery = ` It is out for delivery${data.expectedDelivery ? ` and expected ${data.expectedDelivery.toLowerCase()}` : ''}.`;
  else if (data.status === 'SHIPPED') delivery = ` It is ${data.expectedDelivery ? `expected ${data.expectedDelivery.toLowerCase()}` : 'on its way'}.`;
  else if (data.status === 'DELAYED') delivery = ` It is delayed. ${data.currentLocation ?? 'The carrier has not given a new date yet'}.`;
  else if (data.status === 'DELIVERED') delivery = ` It was delivered${data.deliveredAt ? ` on ${formatDateSpeech(data.deliveredAt)}` : ''}.`;
  else if (data.status === 'CANCELLED') delivery = ' It has been cancelled.';
  return `${name}, order ${data.orderId}, ${verb} ${data.status ? statusToSpeech(data.status) : 'on the way'}.${delivery}`;
}

function formatDateSpeech(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatProductForSpeech(product: Product): string {
  return `${product.brand} ${product.name}${product.specs.color ? ` in ${product.specs.color}` : ''} is ${speakNumber(product.price)}. ${product.inStock ? 'In stock.' : 'Currently out of stock.'} Rated ${product.rating} out of five.`;
}

/** Choose an utterance for a tool result + optional assistant text. */
export function formatSpeechFromTool(tool: string, result: ToolResult): string {
  if (!result.ok) {
    return `I could not complete that just now. ${result.error ?? 'Please try again.'}`;
  }
  switch (tool) {
    case 'getOrders': {
      const data = result.data as { count: number; orders: { orderId: string; status: string; itemNames: string[] }[] };
      if (data.count === 0) return 'You have no recent orders.';
      const latest = data.orders[0];
      return `You have ${data.count} orders. The most recent is ${latest.itemNames[0]} on order ${latest.orderId}, ${statusToSpeech(latest.status)}.`;
    }
    case 'getOrder':
      return formatOrderForSpeech(result.data as Order);
    case 'trackOrder':
    case 'getDeliveryEstimate':
      return formatTrackResult(result.data as Parameters<typeof formatTrackResult>[0]);
    case 'cancelOrder':
      return `Done. Order ${(result.data as { orderId: string }).orderId} has been cancelled. Any payment will be refunded to your original method.`;
    case 'requestReturn':
      return `Return requested on order ${(result.data as { orderId: string }).orderId}. Pickup is scheduled for ${(result.data as { pickupScheduled: string }).pickupScheduled}. Your refund should arrive in about ${(result.data as { refundEtaDays: number }).refundEtaDays} days.`;
    case 'requestReplacement':
      return `Replacement requested on order ${(result.data as { orderId: string }).orderId}. ${(result.data as { expectedDelivery: string }).expectedDelivery}.`;
    case 'getRefundStatus': {
      const refund = (result.data as { refund: { status: string; amount: number; etaDays: number } }).refund;
      if (!refund || refund.status === 'NONE') return 'There is no refund on this order yet.';
      return `Your refund of ${speakNumber(refund.amount)} is ${refund.status.toLowerCase()}.${refund.etaDays ? ` It should reflect in about ${refund.etaDays} days.` : ''}`;
    }
    case 'findProducts': {
      const d = result.data as { matches: { name: string; priceInr: number; brand: string }[]; total: number; category?: string; maxPrice?: number };
      return formatShoppingSpeech(d);
    }
    case 'getProduct':
      return formatProductForSpeech(result.data as Product);
    case 'getProductSpecifications':
    case 'getWarranty': {
      const d = result.data as { name: string; specs?: Record<string, string>; warrantyMonths?: number; coverage?: string[] };
      const bits: string[] = [];
      if (d.specs) for (const [k, v] of Object.entries(d.specs)) bits.push(`${k} is ${v}`);
      if (d.warrantyMonths) bits.push(`warranty ${d.warrantyMonths} months`);
      return `${d.name}. ${bits.length ? bits.join(', ') + '.' : ''}`;
    }
    case 'searchProducts': {
      const list = result.data as { name: string; price: number }[];
      if (list.length === 0) return 'I could not find any matching products.';
      const top = list.slice(0, 3);
      return `I found ${list.length} match${list.length > 1 ? 'es' : ''}. ${top.map((p) => `${p.name}, ${speakNumber(p.price)}`).join('. ')}.`;
    }
    case 'searchOrders': {
      const list = result.data as { orderId: string; status: string }[];
      if (list.length === 0) return 'No matching orders.';
      return `Found ${list.length} order${list.length > 1 ? 's' : ''}. ${list.map((o) => `order ${o.orderId}, ${statusToSpeech(o.status)}`).join('. ')}.`;
    }
    case 'getPaymentStatus': {
      const d = result.data as { orderId: string; paid: boolean; refundStatus: string; amount: number };
      return `Order ${d.orderId}, ${speakNumber(d.amount)}. ${d.paid ? 'Payment received.' : 'Not yet paid.'} Refund status: ${d.refundStatus.toLowerCase()}.`;
    }
    default:
      return JSON.stringify(result.data ?? {}).slice(0, 200);
  }
}

/** Heuristic confirmation wording for destructive tools. */
export function confirmationSummaryFromArgs(tool: string, args: Record<string, unknown>): string {
  const target = (args['orderId'] as string) ?? (args['productName'] as string) ?? 'that order';
  switch (tool) {
    case 'cancelOrder':
      return `Order ${target} will be cancelled and the amount refunded to your original payment method. Shall I go ahead?`;
    case 'requestReturn':
      return `A return will be scheduled on order ${target} with a pickup and refund in about five days. Shall I go ahead?`;
    case 'requestReplacement':
      return `A replacement will be ordered on order ${target} and the old unit collected. Shall I go ahead?`;
    default:
      return `Please confirm that you want to ${tool} for ${target}.`;
  }
}

/** Remove non-wordy filler so Rime gets crisp speech. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[#*`_~>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
}