/**
 * @vaaniresolve/agent — compile-time conformance gate.
 *
 * Type-check only. Proves the authoritative contract (./api) exactly matches
 * the exported Agent class, functions, const, and types. The Agent class is
 * compared through Public<T> (mapped over keyof) so nominal private members
 * don't block the public-surface comparison. AgentRuntime stays internal to
 * each side (not a barrel export) — function equality is structural.
 */

import * as Actual from './index.js';
import * as Declared from './api';
import type { Agent as DeclaredAgent, AgentDecision as DeclaredDecision, AgentKind as DeclaredKind, ToolAction as DeclaredAction } from './api';
import type { Agent as ImplAgent, AgentDecision as ImplDecision, AgentKind as ImplKind, ToolAction as ImplAction } from './index.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Public<T> = { [K in keyof T]: T[K] };

/* Name-set equality — a missing OR extra value export fails here. */
type _valueKeys = Expect<
  Equal<keyof typeof Actual, 'Agent' | 'decideDeterministic' | 'parseDecisionText' | 'SYSTEM_PROMPT'>
>;

/* Class (public surface) + value + type equality. */
type _Agent = Expect<Equal<Public<DeclaredAgent>, Public<ImplAgent>>>;
type _DecideDet = Expect<Equal<typeof Declared.decideDeterministic, typeof Actual.decideDeterministic>>;
type _ParseText = Expect<Equal<typeof Declared.parseDecisionText, typeof Actual.parseDecisionText>>;
type _Prompt = Expect<Equal<typeof Declared.SYSTEM_PROMPT, typeof Actual.SYSTEM_PROMPT>>;
type _Decision = Expect<Equal<DeclaredDecision, ImplDecision>>;
type _Kind = Expect<Equal<DeclaredKind, ImplKind>>;
type _Action = Expect<Equal<DeclaredAction, ImplAction>>;