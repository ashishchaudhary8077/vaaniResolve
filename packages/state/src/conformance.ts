/**
 * @vaaniresolve/state — compile-time conformance gate.
 *
 * Type-check only. Proves the authoritative contract (./api) exactly matches
 * ConversationManager and ConversationContextSnapshot. ConversationManager is
 * compared through Public<T> (mapped over keyof) so nominal private members
 * don't block the public-surface comparison. Dropping an export from either
 * side turns the named import or the keyof union into a compile error.
 */

import * as Actual from './index.js';
import type { ConversationManager as DeclaredManager, ConversationContextSnapshot as DeclaredSnapshot } from './api';
import type {
  ConversationManager as ImplManager,
  ConversationContextSnapshot as ImplSnapshot,
} from './index.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Public<T> = { [K in keyof T]: T[K] };

/* Name-set equality — a missing OR extra value export fails here. */
type _valueKeys = Expect<Equal<keyof typeof Actual, 'ConversationManager'>>;

/* Class (public surface) + type equality. */
type _Manager = Expect<Equal<Public<DeclaredManager>, Public<ImplManager>>>;
type _Snapshot = Expect<Equal<DeclaredSnapshot, ImplSnapshot>>;