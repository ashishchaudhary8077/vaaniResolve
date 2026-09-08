/**
 * VaaniResolve shared domain types.
 * These are the contract used across packages/state, packages/tools,
 * packages/agent, packages/rime, apps/server and apps/web.
 */

/** Explicit conversation states (spec section 4). */
export type ConversationState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'TOOL_RUNNING'
  | 'SPEAKING'
  | 'INTERRUPTED'
  | 'WAITING_CONFIRMATION'
  | 'EXECUTING_ACTION'
  | 'RESOLVED'
  | 'ERROR';

/** Commerce domain (spec section 8). */
export type CommerceDomain =
  | 'order_tracking'
  | 'order_lookup'
  | 'cancellation'
  | 'returns'
  | 'refunds'
  | 'replacements'
  | 'delivery'
  | 'payment'
  | 'product_info'
  | 'warranty'
  | 'general_support';

export interface OrderItem {
  productId: string;
  name: string;
  brand: string;
  color?: string;
  quantity: number;
  price: number;
}

export type OrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELAYED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED'
  | 'REFUNDED'
  | 'REPLACEMENT_REQUESTED';

export interface Order {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  placedAt: string;
  expectedDelivery?: string;
  deliveredAt?: string;
  carrier?: string;
  trackingNumber?: string;
  currentLocation?: string;
  cancellationEligible: boolean;
  returnEligible: boolean;
  refund?: Refund;
  address: Address;
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

export interface Refund {
  amount: number;
  method: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  etaDays?: number;
}

export interface Product {
  productId: string;
  name: string;
  brand: string;
  category: string;
  /** price in USD (legacy order/refund currency) */
  price: number;
  /** Indian-rupee retail price used by the shopping experience (SIH demo) */
  priceInr: number;
  /** one-line highlight shown on product/shopping cards */
  description: string;
  inStock: boolean;
  rating: number;
  specs: Record<string, string>;
  warrantyMonths: number;
  colors: string[];
}

export interface Customer {
  customerId: string;
  name: string;
  email: string;
  phone: string;
}

/** Tool argument schema & definition (structured, validated — never arbitrary). */
export interface ToolArgument {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  domain: CommerceDomain;
  args: ToolArgument[];
  /** latency hint in ms used by the mock to simulate a slow upstream API */
  simulatedLatencyMs?: number;
  /** true if the tool mutates state and therefore needs confirmation */
  destructive?: boolean;
  /** artificial failure rate 0..1 used to simulate unreliable upstream APIs */
  failureRate?: number;
}

/** Result of a tool invocation. Every result carries the request context so
 *  stale results can be identified and discarded. */
export interface ToolResult {
  requestId: string;
  sessionId: string;
  turnId: number;
  generation: number;
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
  stale?: boolean;
}

export interface ConfirmationRequired {
  action: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  orderId?: string;
  confirmationId: string;
}

/** A single validated, spoken-language utterance for Rime. */
export interface SpeechUtterance {
  text: string;
  cards?: ResolutionCard[];
}

export interface ResolutionCard {
  kind: 'order' | 'product' | 'shopping' | 'resolution' | 'refund' | 'delivery';
  title: string;
  subtitle?: string;
  status?: string;
  details?: Record<string, string>;
  /** rendered on product/shopping cards (name, INR price, description, rating) */
  product?: ProductCardData;
  /** optional CTA label shown on shopping/product cards */
  action?: { label: string };
}

/** Lightweight product payload shipped to the UI (never secrets — catalog only). */
export interface ProductCardData {
  productId: string;
  name: string;
  brand: string;
  category: string;
  priceInr: number;
  rating: number;
  inStock: boolean;
  description: string;
}

/* ------------------------------------------------------------ customer care */

/**
 * Handoff summary generated from the CURRENT conversation — never hardcoded.
 * Built client-side from the live transcript + cards so the representative sees
 * exactly what the customer already explained (no need to repeat).
 */
export interface CareSummary {
  mainProblem: string;
  conversationSummary: string;
  importantDetails: string[];
  actionsAlreadyTaken: string[];
  orderShoppingContext: string[];
  currentStatus: string;
  recommendedNextStep: string;
  /** latest user turn that isn't a trivial acknowledgement */
  customerLastAsked?: string;
}

/** Payload the frontend POSTs when handing off to a representative. */
export interface CareHandoffRequest {
  sessionId: string;
  customerName?: string;
  summary: CareSummary;
}

/** Stored representation returned + displayed by the rep dashboard. */
export interface CareHandoff extends CareHandoffRequest {
  handoffId: string;
  receivedAt: number;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
}
