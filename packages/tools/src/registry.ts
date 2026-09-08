/**
 * Commerce tool registry + executor.
 *
 * Tools are real functions over the synthetic dataset (SECTION 8). They model
 * real upstream behaviour: variable latency, occasional timeouts/failures, and
 * cancellation. The stress-test harness can override per-tool latency so the
 * "slow laptop lookup" scenario is deterministic.
 */

import type { Order, Product, ToolResult, ToolDefinition } from '@vaaniresolve/shared';
import { ORDERS, PRODUCTS, CUSTOMERS } from './data.js';

export interface ToolExecutionContext {
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string;
}

export interface ToolOverrides {
  /** deterministic latency for a tool (ms). Stress test uses this to slow getOrderByProduct. */
  latency?: Record<string, number>;
  /** force a failure for a tool. */
  fail?: string[];
  /** enforce a deadline (ms); tools whose latency exceeds it time out gracefully. */
  timeout?: number;
  /** deterministic seed routed through a simple PRNG so tests are repeatable. */
  seed?: number;
}

interface MockTarget {
  order?: Order;
  product?: Product;
}

/* ------------------------------------------------------------------ lookup */

function findByOrderId(orderId: string): Order | undefined {
  return ORDERS.find((o) => o.orderId.toLowerCase() === orderId.trim().toLowerCase());
}

function findByProductName(query: string): { order?: Order; product?: Product } {
  const q = query.trim().toLowerCase();
  // Prefer exact product-name matches on order items so "blue headphones" resolves.
  for (const o of ORDERS) {
    for (const it of o.items) {
      if (it.name.toLowerCase().includes(q) || it.productId.toLowerCase().includes(q)) {
        return { order: o, product: PRODUCTS.find((p) => p.productId === it.productId) };
      }
    }
  }
  const product = PRODUCTS.find((p) => p.name.toLowerCase().includes(q));
  if (product) return { product };
  return {};
}

function resolveTarget(args: Record<string, unknown>): MockTarget {
  const orderId = args['orderId'] as string | undefined;
  if (orderId) {
    const order = findByOrderId(orderId);
    return order ? { order } : {};
  }
  const productName = args['productName'] as string | undefined;
  if (productName) return findByProductName(productName);
  const orderIdByKeyword = args['order'] as string | undefined;
  if (orderIdByKeyword) {
    const order = findByOrderId(orderIdByKeyword);
    return order ? { order } : {};
  }
  return {};
}

/* ------------------------------------------------------------ slow helper */

function elapsedSinceOrder(order: Order): number {
  return Date.now() - new Date(order.placedAt).getTime();
}

const MUTATION_LOG: string[] = [];

export function getMutationLog(): string[] {
  return MUTATION_LOG;
}

/* ------------------------------------------------------------------ tools */

const TOOL_IMPLS: Record<string, (args: Record<string, unknown>) => unknown> = {
  getOrders(_args) {
    return { customer: CUSTOMERS[0].name, count: ORDERS.filter((o) => o.customerId === CUSTOMERS[0].customerId).length, orders: ORDERS.filter((o) => o.customerId === CUSTOMERS[0].customerId).map((o) => ({ orderId: o.orderId, status: o.status, itemNames: o.items.map((i) => i.name), total: o.total })) };
  },
  getOrder(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    return order;
  },
  trackOrder(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    return {
      orderId: order.orderId,
      itemName: order.items[0]?.name ?? '',
      status: order.status,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      currentLocation: order.currentLocation,
      expectedDelivery: order.expectedDelivery,
      deliveredAt: order.deliveredAt,
    };
  },
  searchOrders(args) {
    const q = String(args['query'] ?? '').toLowerCase();
    return ORDERS.filter((o) => o.items.some((i) => i.name.toLowerCase().includes(q)) || o.orderId.toLowerCase().includes(q)).map((o) => ({ orderId: o.orderId, status: o.status, itemNames: o.items.map((i) => i.name) }));
  },
  cancelOrder(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    if (!order.cancellationEligible) throw new Error(`Order ${order.orderId} can no longer be cancelled — it is ${order.status.replace(/_/g, ' ').toLowerCase()}.`);
    order.status = 'CANCELLED';
    MUTATION_LOG.push(`CANCEL ${order.orderId} @${Date.now()}`);
    return { orderId: order.orderId, status: 'CANCELLED', refundInitiated: true };
  },
  requestReturn(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    if (!order.returnEligible) throw new Error(`Order ${order.orderId} is not eligible for return.`);
    order.status = 'RETURN_REQUESTED';
    order.refund = order.refund ?? { amount: order.total, method: 'UPI ••4455', status: 'PENDING', etaDays: 5 };
    MUTATION_LOG.push(`RETURN ${order.orderId} @${Date.now()}`);
    return { orderId: order.orderId, status: 'RETURN_REQUESTED', pickupScheduled: 'Tomorrow', refundEtaDays: 5 };
  },
  requestReplacement(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    order.status = 'REPLACEMENT_REQUESTED';
    MUTATION_LOG.push(`REPLACEMENT ${order.orderId} @${Date.now()}`);
    return { orderId: order.orderId, status: 'REPLACEMENT_REQUESTED', expectedDelivery: 'New unit ships in 24 hours' };
  },
  getRefundStatus(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    return { orderId: order.orderId, refund: order.refund ?? { amount: 0, method: 'N/A', status: 'NONE', etaDays: 0 } };
  },
  getDeliveryEstimate(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    return { orderId: order.orderId, expectedDelivery: order.expectedDelivery, carrier: order.carrier, currentLocation: order.currentLocation };
  },
  getProduct(args) {
    const { product, order } = resolveTarget(args);
    if (!product) throw new Error(`Product not found for "${args['productName'] ?? args['productId']}"`);
    void order;
    return product;
  },
  searchProducts(args) {
    const q = String(args['query'] ?? '').toLowerCase();
    return PRODUCTS.filter((p) => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)).map((p) => ({ productId: p.productId, name: p.name, brand: p.brand, price: p.price, priceInr: p.priceInr, rating: p.rating, inStock: p.inStock }));
  },
  /**
   * Shopping helper — "find a laptop under ₹70,000" / "show me phones".
   * Filters the catalog by category + INR price cap and returns light product
   * cards (catalog data only — no customer/order details).
   */
  findProducts(args) {
    const category = String(args['category'] ?? '').trim().toLowerCase();
    const query = String(args['query'] ?? '').trim().toLowerCase();
    const maxPrice = Number.isFinite(Number(args['maxPrice'])) ? Number(args['maxPrice']) : Number.POSITIVE_INFINITY;
    const matches = PRODUCTS.filter((p) => {
      if (!p.inStock) return false;
      if (maxPrice !== Number.POSITIVE_INFINITY && p.priceInr > maxPrice) return false;
      // category is the primary filter (token-equality, so "phone" can never
      // match the category "Headphones"); query only scans NAME/BRAND.
      const inCategory = !category || p.category.toLowerCase() === category || p.category.toLowerCase().startsWith(category);
      const inQuery = !query || `${p.name} ${p.brand}`.toLowerCase().includes(query);
      return inCategory && inQuery;
    }).sort((a, b) => b.rating - a.rating);
    return {
      matches: matches.slice(0, 4).map((p) => ({
        productId: p.productId,
        name: p.name,
        brand: p.brand,
        category: p.category,
        priceInr: p.priceInr,
        rating: p.rating,
        inStock: p.inStock,
        description: p.description,
      })),
      total: matches.length,
      category: category || undefined,
      maxPrice: maxPrice === Number.POSITIVE_INFINITY ? undefined : maxPrice,
    };
  },
  getProductSpecifications(args) {
    const { product } = resolveTarget(args);
    if (!product) throw new Error(`Product not found for "${args['productName']}"`);
    return { productId: product.productId, name: product.name, specs: product.specs, warrantyMonths: product.warrantyMonths, colors: product.colors };
  },
  getWarranty(args) {
    const { product, order } = resolveTarget(args);
    const target = product ?? order?.items[0]?.['productId'];
    void target;
    const p = product ?? (order ? PRODUCTS.find((x) => x.productId === order.items[0].productId) : undefined);
    if (!p) throw new Error(`No warranty record found.`);
    return { productId: p.productId, name: p.name, warrantyMonths: p.warrantyMonths, coverage: ['Manufacturing defects', 'Battery (if applicable)'], expired: false };
  },
  getPaymentStatus(args) {
    const { order } = resolveTarget(args);
    if (!order) throw new Error(`Order not found for id "${args['orderId']}"`);
    return {
      orderId: order.orderId,
      amount: order.total,
      method: order.refund?.method ?? 'UPI ••4455',
      paid: order.status !== 'CANCELLED',
      refundStatus: order.refund?.status ?? 'N/A',
    };
  },
};

/* ------------------------------------------------------------ definitions */

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'getOrders', description: 'List all recent orders for the current customer.', domain: 'order_lookup', args: [], simulatedLatencyMs: 700 },
  { name: 'getOrder', description: 'Fetch full detail for a single order by orderId or by a purchased product name.', domain: 'order_lookup', args: [{ name: 'orderId', type: 'string', description: 'Order id like VR-48291' }, { name: 'productName', type: 'string', description: 'Product name purchased, e.g. Sony WH-1000XM5 Headphones' }], simulatedLatencyMs: 1600 },
  { name: 'trackOrder', description: 'Track a live order: status, carrier, current location, expected delivery.', domain: 'order_tracking', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 1200 },
  { name: 'searchOrders', description: 'Search orders by keyword (product or order id).', domain: 'order_lookup', args: [{ name: 'query', type: 'string', description: 'Search text' }], simulatedLatencyMs: 800 },
  { name: 'cancelOrder', description: 'Cancel an order that is still eligible. DESTRUCTIVE — requires confirmation.', domain: 'cancellation', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 1400, destructive: true, failureRate: 0.05 },
  { name: 'requestReturn', description: 'Request a return/pickup for an eligible order. DESTRUCTIVE — requires confirmation.', domain: 'returns', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 1300, destructive: true, failureRate: 0.05 },
  { name: 'requestReplacement', description: 'Request a replacement unit for a delivered defective order. DESTRUCTIVE — requires confirmation.', domain: 'replacements', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 1300, destructive: true, failureRate: 0.05 },
  { name: 'getRefundStatus', description: 'Check status of a refund for an order.', domain: 'refunds', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 900 },
  { name: 'getDeliveryEstimate', description: 'Get a delivery estimate for an order.', domain: 'delivery', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 700 },
  { name: 'getProduct', description: 'Fetch a product by name or id.', domain: 'product_info', args: [{ name: 'productName', type: 'string', description: 'Product name' }, { name: 'productId', type: 'string', description: 'Product id' }], simulatedLatencyMs: 600 },
  { name: 'searchProducts', description: 'Search the catalog by keyword.', domain: 'product_info', args: [{ name: 'query', type: 'string', description: 'Search text' }], simulatedLatencyMs: 500 },
  { name: 'findProducts', description: 'Shop the catalog: find in-stock products by category and optional max price in INR (e.g. a laptop under 70000). Returns product cards.', domain: 'product_info', args: [{ name: 'category', type: 'string', description: 'Category keyword, e.g. laptop, headphones, phone, smartwatch, shoes' }, { name: 'query', type: 'string', description: 'Optional keyword filter (product or brand name)' }, { name: 'maxPrice', type: 'number', description: 'Optional maximum price in Indian rupees (INR)' }], simulatedLatencyMs: 700 },
  { name: 'getProductSpecifications', description: 'Get detailed specifications for a product.', domain: 'product_info', args: [{ name: 'productName', type: 'string', description: 'Product name' }], simulatedLatencyMs: 500 },
  { name: 'getWarranty', description: 'Check warranty for a product or purchased order item.', domain: 'warranty', args: [{ name: 'productName', type: 'string', description: 'Product name' }], simulatedLatencyMs: 700 },
  { name: 'getPaymentStatus', description: 'Check whether an order was paid and refund status.', domain: 'payment', args: [{ name: 'orderId', type: 'string', description: 'Order id' }], simulatedLatencyMs: 600 },
];

/* --------------------------------------------------------------- executor */

export function validateArgs(def: ToolDefinition, args: Record<string, unknown>): string | null {
  // Destructive tools must identify a target order by orderId OR by a purchased
  // product name (a single tool arg can't express that OR, so enforce it here).
  if (def.destructive) {
    const id = typeof args['orderId'] === 'string' ? args['orderId'] : undefined;
    const name = typeof args['productName'] === 'string' ? args['productName'] : undefined;
    if (!(id?.trim() || name?.trim())) {
      return `Missing required target (orderId or productName) for destructive tool ${def.name}`;
    }
  }
  for (const a of def.args) {
    if (a.required && (args[a.name] === undefined || args[a.name] === '' || args[a.name] === null)) {
      return `Missing required argument "${a.name}" for tool ${def.name}`;
    }
    if (a.enum && args[a.name] !== undefined && !a.enum.includes(String(args[a.name]))) {
      return `Argument "${a.name}" must be one of ${a.enum.join(', ')}`;
    }
  }
  return null;
}

export interface Executor {
  ctx: ToolExecutionContext;
  overrides?: ToolOverrides;
  /** pragmatically deterministic PRNG */
  random(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  onStart?: (tool: string, requestId: string) => void;
  onComplete?: (requestId: string, tool: string, durationMs: number) => void;
  now(): number;
}

/**
 * Execute a tool with realistic latency/failure and abort support.
 * Returns a ToolResult stamped with the full request context.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  opts: Partial<Executor> & { overrides?: ToolOverrides } = {},
): Promise<ToolResult> {
  const start = Date.now();
  const def = TOOL_DEFINITIONS.find((d) => d.name === toolName);
  if (!def) throw new Error(`Unknown tool "${toolName}"`);

  const validationError = validateArgs(def, args);
  if (validationError) {
    return { requestId: ctx.requestId, sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, tool: toolName, ok: false, error: validationError, latencyMs: 0 };
  }

  // deterministic seeded PRNG so tests are reproducible. Default 7000 is chosen
  // so the FIRST draw (the failure check for destructive tools) exceeds the 5%
  // failureRate — a demo cancellation must complete reliably, not always fail.
  let seed = (opts.overrides?.seed ?? 7000) % 2147483647;
  if (seed <= 0) seed += 2147483646;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const latency = opts.overrides?.latency?.[toolName] ?? def.simulatedLatencyMs ?? 800;
  const deadline = Math.min(
    latency + 2500, // real upstreams can exceed their p50 — allow a grace window
    opts.overrides?.timeout ?? latency + 2500,
  );
  const abs = new AbortController();
  const timeout = setTimeout(() => abs.abort(), deadline);

  opts.onStart?.(toolName, ctx.requestId);
  try {
    // Wait the simulated upstream latency, bounded by the deadline so a hung
    // upstream surfaces as a graceful timeout instead of an infinite wait.
    if (opts.sleep) await opts.sleep(latency, abs.signal);
    else await defaultSleep(latency, abs.signal);

    if (latency > deadline) {
      throw new Error(`Tool ${toolName} timed out after ${deadline}ms`);
    }

    const forcedFail = opts.overrides?.fail?.includes(toolName);
    if (forcedFail) {
      throw new Error(`Upstream ${toolName} API returned a transient error. Please retry.`);
    }
    const failureRate = def.failureRate ?? 0;
    if (failureRate > 0 && random() < failureRate) {
      throw new Error(`Upstream ${toolName} API returned a transient error. Please retry.`);
    }

    const impl = TOOL_IMPLS[toolName];
    if (!impl) throw new Error(`No implementation for ${toolName}`);
    const data = impl(args);
    const latencyMs = Date.now() - start;
    opts.onComplete?.(ctx.requestId, toolName, latencyMs);
    return { requestId: ctx.requestId, sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, tool: toolName, ok: true, data, latencyMs };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const msg = raw === 'aborted' ? `Tool ${toolName} timed out after ${deadline}ms` : raw;
    return { requestId: ctx.requestId, sessionId: ctx.sessionId, turnId: ctx.turnId, generation: ctx.generation, tool: toolName, ok: false, error: msg, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('aborted');
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });
}

export { ORDERS, PRODUCTS, CUSTOMERS };
export type { Order };