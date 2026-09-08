/**
 * @vaaniresolve/rime — AUTHORITATIVE PUBLIC CONTRACT (declaration only).
 *
 * Pins: stream functions, types, 10 format helpers, and the two re-exported
 * shared types (SpeechUtterance, ProductCardData). parseWavHeader is NOT
 * exported by the barrel and is deliberately omitted here.
 */

import type { Order, Product, ToolResult, SpeechUtterance } from '@vaaniresolve/shared';

/* -------------------------------------------------------------- types */

export interface RimeConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  speaker: string;
  language: string;
  sampleRate: number;
}

export interface RimeChunk {
  audioBase64?: string;
  text?: string;
  done?: boolean;
  sampleRate?: number;
}

export interface RimeStreamHandle {
  abort(): void;
  done(): Promise<void>;
}

/* re-exports from shared */
export type { SpeechUtterance } from '@vaaniresolve/shared';
export type { ProductCardData } from '@vaaniresolve/shared';

/* ------------------------------------------------------------ stream functions */

export function loadRimeConfig(
  env?: Record<string, string | undefined>,
  log?: (m: string) => void,
): RimeConfig;

export function parseSseChunk(raw: string): RimeChunk | null;

export function buildRequest(
  config: RimeConfig,
  utterance: SpeechUtterance,
  stream?: boolean,
): { url: string; headers: Record<string, string>; body: string };

export async function streamRime(
  config: RimeConfig,
  utterance: SpeechUtterance,
  onChunk: (chunk: RimeChunk) => void,
  opts?: { signal?: AbortSignal; fetchFn?: typeof fetch },
): Promise<RimeStreamHandle>;

export function synthFallback(
  text: string,
  rateHz?: number,
): { audioBase64: string; rateHz: number; disclosed: boolean; reason: string };

/* ------------------------------------------------------------ format helpers */

export function speakNumber(n: number): string;
export function speakInr(n: number): string;
export function formatShoppingSpeech(data: {
  matches: { name: string; priceInr: number; brand: string }[];
  total: number;
  category?: string;
  maxPrice?: number;
}): string;
export function statusToSpeech(status: string): string;
export function formatOrderForSpeech(order: Order, verb?: string): string;
export function formatTrackResult(
  data: {
    orderId: string;
    itemName?: string;
    status?: string;
    carrier?: string;
    currentLocation?: string;
    expectedDelivery?: string;
    deliveredAt?: string;
  },
  verb?: string,
): string;
export function formatProductForSpeech(product: Product): string;
export function formatSpeechFromTool(tool: string, result: ToolResult): string;
export function confirmationSummaryFromArgs(tool: string, args: Record<string, unknown>): string;
export function cleanForSpeech(text: string): string;