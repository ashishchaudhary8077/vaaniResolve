/**
 * @vaaniresolve/tools — AUTHORITATIVE PUBLIC CONTRACT (declaration only).
 *
 * Pins every exported value and type from the barrel (data + registry).
 * Data constants are typed as their literal runtime values; the registry
 * function signatures match the implementation exactly.
 */

import type {
  Customer,
  Order,
  Product,
  ToolDefinition,
  ToolResult,
} from '@vaaniresolve/shared';

/* -------------------------------------------------------------- data */

export const CUSTOMERS: Customer[];
export const PRODUCTS: Product[];
export const ORDERS: Order[];
export const DEFAULT_CUSTOMER: Customer;

/* ------------------------------------------------------------ registry */

export interface ToolExecutionContext {
  sessionId: string;
  turnId: number;
  generation: number;
  requestId: string;
}

export interface ToolOverrides {
  latency?: Record<string, number>;
  fail?: string[];
  timeout?: number;
  seed?: number;
}

export interface Executor {
  ctx: ToolExecutionContext;
  overrides?: ToolOverrides;
  random(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  onStart?: (tool: string, requestId: string) => void;
  onComplete?: (requestId: string, tool: string, durationMs: number) => void;
  now(): number;
}

export const TOOL_DEFINITIONS: ToolDefinition[];

export function getMutationLog(): string[];

export function validateArgs(
  def: ToolDefinition,
  args: Record<string, unknown>,
): string | null;

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  opts?: Partial<Executor> & { overrides?: ToolOverrides },
): Promise<ToolResult>;

/* re-exports (registry.ts trailing exports) */
export type { Order };