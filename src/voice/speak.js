/**
 * Personal AI Companion â€” Speech Output Module (Text-to-Speech)
 *
 * Provides accessible, sequential speech synthesis with chunking
 * to avoid browser speech engine cutoffs on long text, and reliable
 * cancellation support ("Stop reading").
 */

let speechQueue = [];
let currentUtterance = null;
let isPlaying = false;
let isPaused = false;
let cachedEnglishVoice = null;
let activeCallbacks = {
  onStart: null,
  onEnd: null,
  onError: null,
  onPause: null,
  onResume: null,
};

/**
 * Checks whether speech synthesis is supported in this browser.
 * @returns {boolean}
 */
export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/**
 * Selects a high-clarity, natural English voice from the browser's available voices.
 * @returns {SpeechSynthesisVoice|null}
 */
export function getPreferredEnglishVoice() {
  if (!isSpeechSupported()) return null;
  if (cachedEnglishVoice) return cachedEnglishVoice;

  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
  if (englishVoices.length === 0) return voices[0] || null;

  // Prefer high quality / natural voices available on Chrome, Edge, Safari, or Windows/macOS
  const preferred = englishVoices.find(
    (v) =>
      v.name.includes('Natural') ||
      v.name.includes('Neural') ||
      v.name.includes('Google') ||
      v.name.includes('Aria') ||
      v.name.includes('Jenny') ||
      v.name.includes('Samantha') ||
      v.name.includes('David') ||
      v.name.includes('Guy')
  );

  cachedEnglishVoice = preferred || englishVoices.find((v) => v.default) || englishVoices[0];
  return cachedEnglishVoice;
}

// Asynchronously load and cache voices when the browser signals they are ready
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedEnglishVoice = null;
    getPreferredEnglishVoice();
  };
}

/**
 * Checks whether speech is currently actively playing (not paused).
 * @returns {boolean}
 */
export function isSpeaking() {
  return isPlaying && !isPaused;
}

/**
 * Checks whether speech is currently paused.
 * @returns {boolean}
 */
export function isSpeechPaused() {
  return isPaused;
}

/**
 * Temporarily pauses speech playback while keeping the current utterance
 * and remaining queued chunks intact.
 * @returns {boolean} True if speech was successfully paused
 */
export function pauseSpeaking() {
  if (!isPlaying || isPaused) return false;

  isPaused = true;

  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.pause();
    } catch (err) {
      console.warn('Error during speechSynthesis.pause():', err);
    }
  }

  if (typeof activeCallbacks.onPause === 'function') {
    try {
      activeCallbacks.onPause();
    } catch (err) {
      console.error('Error in speech onPause callback:', err);
    }
  }

  return true;
}

/**
 * Resumes speech playback from the paused state without restarting
 * the document from the beginning or discarding queued chunks.
 * @returns {boolean} True if speech was resumed
 */
export function resumeSpeaking() {
  if (!isPlaying || !isPaused) return false;

  isPaused = false;

  if (typeof activeCallbacks.onResume === 'function') {
    try {
      activeCallbacks.onResume();
    } catch (err) {
      console.error('Error in speech onResume callback:', err);
    }
  }

  if (isSpeechSupported()) {
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        return true;
      }
    } catch (err) {
      console.warn('Error during speechSynthesis.resume():', err);
    }
  }

  // If the browser did not pause an active utterance or chunk ended right as paused, continue queue
  if (!currentUtterance) {
    playNextChunk();
  }

  return true;
}

/**
 * Cancels any active speech utterance and clears remaining queued chunks.
 */
export function stopSpeaking() {
  speechQueue = [];
  const wasActive = isPlaying || isPaused;
  isPlaying = false;
  isPaused = false;
  currentUtterance = null;

  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch (err) {
      console.warn('Error during speechSynthesis.cancel():', err);
    }
  }

  if (wasActive && typeof activeCallbacks.onEnd === 'function') {
    try {
      activeCallbacks.onEnd();
    } catch (err) {
      console.error('Error in speech onEnd callback:', err);
    }
  }

  activeCallbacks = { onStart: null, onEnd: null, onError: null, onPause: null, onResume: null };
}

/**
 * Speaks the next chunk in the sequential queue.
 */
function playNextChunk() {
  if (!isPlaying || isPaused) return;

  if (speechQueue.length === 0) {
    // Finished speaking all chunks
    isPlaying = false;
    isPaused = false;
    currentUtterance = null;
    if (typeof activeCallbacks.onEnd === 'function') {
      try {
        activeCallbacks.onEnd();
      } catch (err) {
        console.error('Error in speech onEnd callback:', err);
      }
    }
    return;
  }

  const chunk = speechQueue.shift();
  if (!chunk || !chunk.trim()) {
    playNextChunk();
    return;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(chunk);
    currentUtterance = utterance;

    // Select preferred natural English voice
    const voice = getPreferredEnglishVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }

    // Accessible, slower, easy-to-follow speech rate and comfortable volume
    utterance.rate = 0.8;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      currentUtterance = null;
      if (isPaused) {
        // Paused right as chunk ended; do not advance until resumeSpeaking() is called
        return;
      }
      // Natural 140ms pause between chunks for human cadence
      setTimeout(() => {
        if (isPlaying && !isPaused) {
          playNextChunk();
        }
      }, 140);
    };

    utterance.onerror = (event) => {
      // Ignore errors caused by explicit cancellation
      if (event.error === 'canceled' || event.error === 'interrupted') {
        return;
      }
      console.warn('SpeechSynthesisUtterance error:', event);
      if (typeof activeCallbacks.onError === 'function') {
        try {
          activeCallbacks.onError(new Error(`Speech synthesis error: ${event.error || 'unknown'}`));
        } catch (e) {
          console.error(e);
        }
      }
      // Continue to next chunk even if one chunk failed
      if (isPlaying && !isPaused) {
        playNextChunk();
      }
    };

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Failed to speak chunk:', err);
    if (isPlaying && !isPaused) {
      playNextChunk();
    }
  }
}

/**
 * Formats text for clear, accessible pronunciation by screen readers and speech synthesizers.
 * - Enunciates 10-digit mobile numbers as grouped digits (e.g. "9 9 4 8 8, 4 8 7 4 1")
 * - Enunciates 6-digit pincodes and postal codes as digit groups
 * - Enunciates door/address numbers (e.g. "6/9" as "6 by 9")
 * - Cleans stray scanner noise symbols (pipes, slashes, tildes)
 *
 * @param {string} text
 * @returns {string} Formatted speech-ready string
 */
export function formatTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // Replace slash in address door numbers like "6/9" with "6 by 9"
    .replace(/\b(\d+)\/(\d+)\b/g, (m, a, b) => `${a} by ${b}`)
    // Format 10-digit mobile numbers into 5-5 grouped spaced digits so speech engine reads them clearly
    .replace(/\b(\d{5})(\d{5})\b/g, (m, g1, g2) => `${g1.split('').join(' ')}, ${g2.split('').join(' ')}`)
    // Format 6-digit pincodes/postal codes into 3-3 grouped spaced digits (e.g. "5 2 2, 0 0 2")
    .replace(/\b(\d{3})(\d{3})\b/g, (m, g1, g2) => `${g1.split('').join(' ')}, ${g2.split('').join(' ')}`)
    // Any remaining 4+ digit numbers: space out digits so they are not read as large cardinal integers
    .replace(/\b(\d{4,})\b/g, (m) => m.split('').join(' '))
    // Expand ampersands for natural reading
    .replace(/&/g, ' and ')
    // Clean text of raw scanner symbols (pipes, tildes, backslashes, repeated dashes)
    .replace(/[|~\\/_#^=]+/g, ' ')
    .replace(/[-]{2,}/g, ' ')
    // Convert newlines into clear sentence pauses so lines do not run into each other
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a long text into accessible sentence or phrase chunks of roughly maxChunkLength (~200 characters),
 * ensuring words and sentences are not split unnaturally.
 *
 * @param {string} text Raw text to split
 * @param {number} [maxChunkLength=200]
 * @returns {string[]} Array of speakable text chunks
 */
export function splitTextIntoChunks(text, maxChunkLength = 200) {
  if (!text || typeof text !== 'string') return [];

  // Normalize whitespace
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChunkLength) return [clean];

  const chunks = [];
  // Split on sentence boundaries (period, exclamation, question mark, colon, semicolon)
  const sentenceRegex = /([^.!?:;\n]+[.!?:\n]+)/g;
  const rawSentences = clean.match(sentenceRegex) || [clean];

  let currentChunk = '';

  for (const sentence of rawSentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;

    // If adding this sentence stays within chunk limit, append it
    if ((currentChunk + ' ' + trimmedSentence).trim().length <= maxChunkLength) {
      currentChunk = currentChunk ? `${currentChunk} ${trimmedSentence}` : trimmedSentence;
    } else {
      // If currentChunk already has content, push it first
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // If the sentence itself exceeds maxChunkLength, split by word boundaries
      if (trimmedSentence.length > maxChunkLength) {
        const words = trimmedSentence.split(' ');
        let wordChunk = '';
        for (const word of words) {
          if (!word) continue;
          if ((wordChunk + ' ' + word).trim().length <= maxChunkLength) {
            wordChunk = wordChunk ? `${wordChunk} ${word}` : word;
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = word;
          }
        }
        if (wordChunk) {
          currentChunk = wordChunk;
        }
      } else {
        currentChunk = trimmedSentence;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter((c) => c && c.trim().length > 0);
}

/**
 * Speaks text using sequential chunking, cancelling any speech already in progress.
 * Cleans out raw scanner symbol noise and enunciates phone numbers clearly before speaking.
 *
 * @param {string} text Text to speak
 * @param {Object} [options]
 * @param {Function} [options.onStart] Called when speech begins
 * @param {Function} [options.onEnd] Called when speech finishes or is stopped
 * @param {Function} [options.onError] Called on error
 * @returns {boolean} True if speech started, false if unsupported or empty text
 */
export function speakText(text, options = {}) {
  // Always stop previous speech first
  stopSpeaking();

  if (!isSpeechSupported()) {
    console.warn('SpeechSynthesis is not supported in this browser.');
    return false;
  }

  if (!text || typeof text !== 'string' || !text.trim()) {
    return false;
  }

  // Format text for clear pronunciation of phone numbers, addresses, and symbols
  const speakableText = formatTextForSpeech(text);

  if (!speakableText) return false;

  const chunks = splitTextIntoChunks(speakableText, 200);
  if (chunks.length === 0) return false;

  speechQueue = chunks;
  isPlaying = true;
  activeCallbacks = {
    onStart: options.onStart || null,
    onEnd: options.onEnd || null,
    onError: options.onError || null,
  };

  if (typeof activeCallbacks.onStart === 'function') {
    try {
      activeCallbacks.onStart();
    } catch (err) {
      console.error('Error in speech onStart callback:', err);
    }
  }

  playNextChunk();
  return true;
}
