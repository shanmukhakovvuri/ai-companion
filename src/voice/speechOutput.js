let activeSpeech = null;

function createSpeechError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Speaks text with the browser's speech synthesis voice.
 * Resolves true when finished, or false when the text is empty or stopped.
 * An identical utterance already in progress reuses its promise.
 *
 * @param {string} text
 * @param {{ lang?: string, rate?: number, pitch?: number, voice?: SpeechSynthesisVoice }} [options]
 * @returns {Promise<boolean>}
 */
export function speakText(text, { lang, rate, pitch, voice } = {}) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) return Promise.resolve(false);

  const synthesis = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  if (!synthesis || typeof Utterance !== 'function') {
    return Promise.reject(createSpeechError(
      'unsupported',
      'Spoken responses are not supported in this browser.',
    ));
  }

  if (activeSpeech?.text === normalizedText) return activeSpeech.promise;
  if (activeSpeech) stopSpeaking();

  const utterance = new Utterance(normalizedText);
  if (lang) utterance.lang = lang;
  if (typeof rate === 'number') utterance.rate = rate;
  if (typeof pitch === 'number') utterance.pitch = pitch;
  if (voice) utterance.voice = voice;

  let resolveSpeech;
  let rejectSpeech;
  const promise = new Promise((resolve, reject) => {
    resolveSpeech = resolve;
    rejectSpeech = reject;
  });
  const speech = { text: normalizedText, promise, resolve: resolveSpeech };
  activeSpeech = speech;

  utterance.onend = () => {
    if (activeSpeech !== speech) return;
    activeSpeech = null;
    speech.resolve(true);
  };
  utterance.onerror = (event) => {
    if (activeSpeech !== speech) return;
    activeSpeech = null;
    rejectSpeech(createSpeechError(
      event.error || 'speech-error',
      'The spoken response could not be played.',
    ));
  };

  try {
    synthesis.speak(utterance);
  } catch {
    activeSpeech = null;
    rejectSpeech(createSpeechError('speech-error', 'The spoken response could not be started.'));
  }

  return promise;
}

/** Stops the current spoken response and returns whether one was active. */
export function stopSpeaking() {
  const speech = activeSpeech;
  if (!speech) return false;

  activeSpeech = null;
  try {
    globalThis.speechSynthesis?.cancel();
  } finally {
    speech.resolve(false);
  }
  return true;
}