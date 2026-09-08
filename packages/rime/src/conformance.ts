/**
 * @vaaniresolve/rime — compile-time conformance gate.
 *
 * Type-check only. Proves the authoritative contract (./api) exactly matches
 * the exported stream functions, format helpers, and types. Value exports are
 * compared via a real namespace import (typeof); type exports via named type
 * imports (including the two shared re-exports).
 */

import * as Actual from './index.js';
import * as Declared from './api';
import type {
  RimeConfig as DeclaredConfig,
  RimeChunk as DeclaredChunk,
  RimeStreamHandle as DeclaredHandle,
  SpeechUtterance as DeclaredSpeech,
  ProductCardData as DeclaredCard,
} from './api';
import type {
  RimeConfig as ImplConfig,
  RimeChunk as ImplChunk,
  RimeStreamHandle as ImplHandle,
  SpeechUtterance as ImplSpeech,
  ProductCardData as ImplCard,
} from './index.js';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* Name-set equality — a missing OR extra value export fails here. */
type _valueKeys = Expect<
  Equal<
    keyof typeof Actual,
    | 'loadRimeConfig'
    | 'parseSseChunk'
    | 'streamRime'
    | 'synthFallback'
    | 'buildRequest'
    | 'speakNumber'
    | 'speakInr'
    | 'formatShoppingSpeech'
    | 'statusToSpeech'
    | 'formatOrderForSpeech'
    | 'formatTrackResult'
    | 'formatProductForSpeech'
    | 'formatSpeechFromTool'
    | 'confirmationSummaryFromArgs'
    | 'cleanForSpeech'
  >
>;

/* Value equality. */
type _Load = Expect<Equal<typeof Declared.loadRimeConfig, typeof Actual.loadRimeConfig>>;
type _Parse = Expect<Equal<typeof Declared.parseSseChunk, typeof Actual.parseSseChunk>>;
type _Stream = Expect<Equal<typeof Declared.streamRime, typeof Actual.streamRime>>;
type _Synth = Expect<Equal<typeof Declared.synthFallback, typeof Actual.synthFallback>>;
type _Build = Expect<Equal<typeof Declared.buildRequest, typeof Actual.buildRequest>>;
type _SpeakNum = Expect<Equal<typeof Declared.speakNumber, typeof Actual.speakNumber>>;
type _SpeakInr = Expect<Equal<typeof Declared.speakInr, typeof Actual.speakInr>>;
type _Shopping = Expect<Equal<typeof Declared.formatShoppingSpeech, typeof Actual.formatShoppingSpeech>>;
type _Status = Expect<Equal<typeof Declared.statusToSpeech, typeof Actual.statusToSpeech>>;
type _Order = Expect<Equal<typeof Declared.formatOrderForSpeech, typeof Actual.formatOrderForSpeech>>;
type _Track = Expect<Equal<typeof Declared.formatTrackResult, typeof Actual.formatTrackResult>>;
type _Product = Expect<Equal<typeof Declared.formatProductForSpeech, typeof Actual.formatProductForSpeech>>;
type _FromTool = Expect<Equal<typeof Declared.formatSpeechFromTool, typeof Actual.formatSpeechFromTool>>;
type _Confirm = Expect<Equal<typeof Declared.confirmationSummaryFromArgs, typeof Actual.confirmationSummaryFromArgs>>;
type _Clean = Expect<Equal<typeof Declared.cleanForSpeech, typeof Actual.cleanForSpeech>>;

/* Type equality (including shared re-exports). */
type _Cfg = Expect<Equal<DeclaredConfig, ImplConfig>>;
type _Chunk = Expect<Equal<DeclaredChunk, ImplChunk>>;
type _Handle = Expect<Equal<DeclaredHandle, ImplHandle>>;
type _Speech = Expect<Equal<DeclaredSpeech, ImplSpeech>>;
type _Card = Expect<Equal<DeclaredCard, ImplCard>>;