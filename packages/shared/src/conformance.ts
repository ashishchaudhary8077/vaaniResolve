/**
 * @vaaniresolve/shared — compile-time conformance gate.
 *
 * Type-check only (tsc --noEmit). Proves the authoritative contract (./api)
 * exactly matches the implementation's exported type surface. Because shared
 * exports only types, the gate is pure type equality; a name dropped from
 * either file becomes a TS2305 import error. Values must NOT leak here.
 *
 * Deliberately never executed: the name does not end in `.test.ts`.
 */

import * as Actual from './index.js';
import type {
  ConversationState as DeclaredConversationState,
  CommerceDomain as DeclaredCommerceDomain,
  OrderItem as DeclaredOrderItem,
  OrderStatus as DeclaredOrderStatus,
  Order as DeclaredOrder,
  Address as DeclaredAddress,
  Refund as DeclaredRefund,
  Product as DeclaredProduct,
  Customer as DeclaredCustomer,
  ToolArgument as DeclaredToolArgument,
  ToolDefinition as DeclaredToolDefinition,
  ToolResult as DeclaredToolResult,
  ConfirmationRequired as DeclaredConfirmationRequired,
  SpeechUtterance as DeclaredSpeechUtterance,
  ResolutionCard as DeclaredResolutionCard,
  ProductCardData as DeclaredProductCardData,
  CareSummary as DeclaredCareSummary,
  CareHandoffRequest as DeclaredCareHandoffRequest,
  CareHandoff as DeclaredCareHandoff,
  ProtocolEventName as DeclaredProtocolEventName,
  WireMessage as DeclaredWireMessage,
  SessionContext as DeclaredSessionContext,
  ClientHello as DeclaredClientHello,
  ClientUserSpeech as DeclaredClientUserSpeech,
  ServerMetrics as DeclaredServerMetrics,
  AssistantPayload as DeclaredAssistantPayload,
  ConfirmationPayload as DeclaredConfirmationPayload,
  ConfirmationAnswer as DeclaredConfirmationAnswer,
  ToolEventPayload as DeclaredToolEventPayload,
  ErrorPayload as DeclaredErrorPayload,
  ResolutionPayload as DeclaredResolutionPayload,
} from './api';
import type {
  ConversationState as ImplConversationState,
  CommerceDomain as ImplCommerceDomain,
  OrderItem as ImplOrderItem,
  OrderStatus as ImplOrderStatus,
  Order as ImplOrder,
  Address as ImplAddress,
  Refund as ImplRefund,
  Product as ImplProduct,
  Customer as ImplCustomer,
  ToolArgument as ImplToolArgument,
  ToolDefinition as ImplToolDefinition,
  ToolResult as ImplToolResult,
  ConfirmationRequired as ImplConfirmationRequired,
  SpeechUtterance as ImplSpeechUtterance,
  ResolutionCard as ImplResolutionCard,
  ProductCardData as ImplProductCardData,
  CareSummary as ImplCareSummary,
  CareHandoffRequest as ImplCareHandoffRequest,
  CareHandoff as ImplCareHandoff,
  ProtocolEventName as ImplProtocolEventName,
  WireMessage as ImplWireMessage,
  SessionContext as ImplSessionContext,
  ClientHello as ImplClientHello,
  ClientUserSpeech as ImplClientUserSpeech,
  ServerMetrics as ImplServerMetrics,
  AssistantPayload as ImplAssistantPayload,
  ConfirmationPayload as ImplConfirmationPayload,
  ConfirmationAnswer as ImplConfirmationAnswer,
  ToolEventPayload as ImplToolEventPayload,
  ErrorPayload as ImplErrorPayload,
  ResolutionPayload as ImplResolutionPayload,
} from './index.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* Type-only package: the implementation must expose NO runtime values. */
type _noValues = Expect<Equal<keyof typeof Actual, never>>;

/* Per-type equality — the contract must mirror the implementation exactly. */
type _ConversationState = Expect<Equal<DeclaredConversationState, ImplConversationState>>;
type _CommerceDomain = Expect<Equal<DeclaredCommerceDomain, ImplCommerceDomain>>;
type _OrderItem = Expect<Equal<DeclaredOrderItem, ImplOrderItem>>;
type _OrderStatus = Expect<Equal<DeclaredOrderStatus, ImplOrderStatus>>;
type _Order = Expect<Equal<DeclaredOrder, ImplOrder>>;
type _Address = Expect<Equal<DeclaredAddress, ImplAddress>>;
type _Refund = Expect<Equal<DeclaredRefund, ImplRefund>>;
type _Product = Expect<Equal<DeclaredProduct, ImplProduct>>;
type _Customer = Expect<Equal<DeclaredCustomer, ImplCustomer>>;
type _ToolArgument = Expect<Equal<DeclaredToolArgument, ImplToolArgument>>;
type _ToolDefinition = Expect<Equal<DeclaredToolDefinition, ImplToolDefinition>>;
type _ToolResult = Expect<Equal<DeclaredToolResult, ImplToolResult>>;
type _ConfirmationRequired = Expect<Equal<DeclaredConfirmationRequired, ImplConfirmationRequired>>;
type _SpeechUtterance = Expect<Equal<DeclaredSpeechUtterance, ImplSpeechUtterance>>;
type _ResolutionCard = Expect<Equal<DeclaredResolutionCard, ImplResolutionCard>>;
type _ProductCardData = Expect<Equal<DeclaredProductCardData, ImplProductCardData>>;
type _CareSummary = Expect<Equal<DeclaredCareSummary, ImplCareSummary>>;
type _CareHandoffRequest = Expect<Equal<DeclaredCareHandoffRequest, ImplCareHandoffRequest>>;
type _CareHandoff = Expect<Equal<DeclaredCareHandoff, ImplCareHandoff>>;
type _ProtocolEventName = Expect<Equal<DeclaredProtocolEventName, ImplProtocolEventName>>;
type _WireMessage = Expect<Equal<DeclaredWireMessage, ImplWireMessage>>;
type _SessionContext = Expect<Equal<DeclaredSessionContext, ImplSessionContext>>;
type _ClientHello = Expect<Equal<DeclaredClientHello, ImplClientHello>>;
type _ClientUserSpeech = Expect<Equal<DeclaredClientUserSpeech, ImplClientUserSpeech>>;
type _ServerMetrics = Expect<Equal<DeclaredServerMetrics, ImplServerMetrics>>;
type _AssistantPayload = Expect<Equal<DeclaredAssistantPayload, ImplAssistantPayload>>;
type _ConfirmationPayload = Expect<Equal<DeclaredConfirmationPayload, ImplConfirmationPayload>>;
type _ConfirmationAnswer = Expect<Equal<DeclaredConfirmationAnswer, ImplConfirmationAnswer>>;
type _ToolEventPayload = Expect<Equal<DeclaredToolEventPayload, ImplToolEventPayload>>;
type _ErrorPayload = Expect<Equal<DeclaredErrorPayload, ImplErrorPayload>>;
type _ResolutionPayload = Expect<Equal<DeclaredResolutionPayload, ImplResolutionPayload>>;