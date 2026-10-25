/**
 * Personal AI Companion — Wake Word Detection & Command Extraction
 *
 * Wake Phrase: "Hey Companion" (also supports "Okay Companion" / "Ok Companion")
 *
 * Provides safe, robust parsing of transcripts to detect the wake phrase
 * and extract any trailing command in single-utterance or two-step styles.
 */

export const WAKE_PHRASE = 'Hey Companion';

/**
 * Pattern matching the wake phrase with strict word boundaries.
 * Case-insensitive, supports optional punctuation after "Hey" or "Ok(ay)".
 */
const WAKE_PHRASE_REGEX = /\b(?:hey|okay|ok)\s*[,]?\s*companion\b/i;

/**
 * Pattern matching the wake phrase and capturing everything following it.
 */
const WAKE_PHRASE_CAPTURE_REGEX = /\b(?:hey|okay|ok)\s*[,]?\s*companion\b(?:[,\s:-]+(.*))?$/i;

/**
 * Normalizes punctuation and excessive whitespace from speech transcripts.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeTranscript(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{M}\p{N}\s',.?!-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cleans command text by stripping leading/trailing punctuation and any
 * redundant wake phrases the user may have spoken.
 *
 * @param {string} command
 * @returns {string}
 */
export function cleanCommandText(command) {
  if (typeof command !== 'string') return '';
  let cleaned = normalizeTranscript(command);

  // If user repeated the wake phrase at start of command, strip it
  cleaned = cleaned.replace(/^\s*(?:hey|okay|ok)\s*[,]?\s*companion\s*[,:-]?\s*/i, '');

  // Strip leading and trailing punctuation marks
  cleaned = cleaned.replace(/^[,\s.!?:;-]+|[,\s.!?:;-]+$/g, '').trim();

  return cleaned;
}

/**
 * Inspects a transcript to determine if the wake phrase was spoken,
 * and extracts any trailing command if present in the same utterance.
 *
 * Supports:
 * - "Hey Companion" -> { hasWakePhrase: true, command: "" }
 * - "Hey, Companion" -> { hasWakePhrase: true, command: "" }
 * - "Okay Companion" -> { hasWakePhrase: true, command: "" }
 * - "Hey Companion, describe this image" -> { hasWakePhrase: true, command: "describe this image" }
 * - "Hey Companion, read text" -> { hasWakePhrase: true, command: "read text" }
 * - "Hey Companion, open YouTube" -> { hasWakePhrase: true, command: "open YouTube" }
 *
 * Will NOT match substrings in unrelated words like "they companionable".
 *
 * @param {string} transcript
 * @returns {{ hasWakePhrase: boolean, command: string }}
 */
export function parseWakePhrase(transcript) {
  if (typeof transcript !== 'string') {
    return { hasWakePhrase: false, command: '' };
  }

  const normalized = normalizeTranscript(transcript);
  if (!normalized) {
    return { hasWakePhrase: false, command: '' };
  }

  // Check if wake phrase exists with word boundaries
  if (!WAKE_PHRASE_REGEX.test(normalized)) {
    return { hasWakePhrase: false, command: '' };
  }

  const match = normalized.match(WAKE_PHRASE_CAPTURE_REGEX);
  if (!match) {
    return { hasWakePhrase: true, command: '' };
  }

  const trailingRaw = match[1] || '';
  const command = cleanCommandText(trailingRaw);

  return {
    hasWakePhrase: true,
    command,
  };
}
