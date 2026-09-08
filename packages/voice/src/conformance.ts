/**
 * @vaaniresolve/voice — compile-time conformance gate.
 *
 * Type-check only. Proves the authoritative contract (./api) exactly matches
 * AudioPlaybackController, InterruptController, and the exported types. Both
 * classes are compared through Public<T> (mapped over keyof) so nominal
 * private members don't block the public-surface comparison.
 */

import * as Actual from './index.js';
import * as Declared from './api';
import type {
  AudioPlaybackController as DeclaredAudio,
  InterruptController as DeclaredInterrupt,
  PlaybackItem as DeclaredItem,
  AudioControllerCallbacks as DeclaredCallbacks,
} from './api';
import type {
  AudioPlaybackController as ImplAudio,
  InterruptController as ImplInterrupt,
  PlaybackItem as ImplItem,
  AudioControllerCallbacks as ImplCallbacks,
} from './index.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Public<T> = { [K in keyof T]: T[K] };

/* Name-set equality — a missing OR extra value export fails here. */
type _valueKeys = Expect<Equal<keyof typeof Actual, 'AudioPlaybackController' | 'InterruptController'>>;

/* Class (public surface) + type equality. */
type _Audio = Expect<Equal<Public<DeclaredAudio>, Public<ImplAudio>>>;
type _Interrupt = Expect<Equal<Public<DeclaredInterrupt>, Public<ImplInterrupt>>>;
type _Item = Expect<Equal<DeclaredItem, ImplItem>>;
type _Callbacks = Expect<Equal<DeclaredCallbacks, ImplCallbacks>>;