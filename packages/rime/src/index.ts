export {
  loadRimeConfig,
  parseSseChunk,
  streamRime,
  synthFallback,
  buildRequest,
  type RimeConfig,
  type RimeChunk,
  type RimeStreamHandle,
} from './stream.js';
export {
  speakNumber,
  speakInr,
  formatShoppingSpeech,
  statusToSpeech,
  formatOrderForSpeech,
  formatTrackResult,
  formatProductForSpeech,
  formatSpeechFromTool,
  confirmationSummaryFromArgs,
  cleanForSpeech,
} from './format.js';
export type { SpeechUtterance } from '@vaaniresolve/shared';
export type { ProductCardData } from '@vaaniresolve/shared';