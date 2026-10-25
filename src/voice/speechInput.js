export function getRecognitionConstructor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function createRecognitionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getRecognitionError(errorCode) {
  const errors = {
    'not-allowed': ['permission-denied', 'Microphone permission was denied. Allow microphone access and try again.'],
    'service-not-allowed': ['permission-denied', 'The browser did not allow speech recognition. Check microphone permissions.'],
    'audio-capture': ['microphone-unavailable', 'No microphone is available. Connect or enable a microphone and try again.'],
    'no-speech': ['no-speech', 'No speech was detected. Try speaking again.'],
    network: ['network-error', 'Speech recognition could not connect. Check your connection and try again.'],
    aborted: ['aborted', 'Speech recognition was stopped.'],
  };
  const [code, message] = errors[errorCode] || [
    'recognition-error',
    'Speech recognition failed. Please try again.',
  ];
  return createRecognitionError(code, message);
}

let activeRecognition = null;

export function getActiveRecognition() {
  return activeRecognition;
}

export function setActiveRecognition(rec) {
  activeRecognition = rec;
}

/** Returns whether this browser exposes the Web Speech recognition API. */
export function isSpeechRecognitionSupported() {
  return typeof getRecognitionConstructor() === 'function';
}

/**
 * Starts browser speech recognition after an explicit caller action.
 * Resolves with the final transcript, or rejects with an Error whose `code`
 * identifies unsupported, permission, no-speech, or recognition failures.
 *
 * @param {{ lang?: string, interimResults?: boolean, continuous?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function startSpeechRecognition({
  lang = 'en-US',
  interimResults = false,
  continuous = false,
} = {}) {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) {
    return Promise.reject(createRecognitionError(
      'unsupported',
      'Speech recognition is not supported in this browser. Try a supported browser such as Chrome or Edge.',
    ));
  }

  // If another recognition session is active, stop it cleanly and await microphone release
  if (activeRecognition) {
    await stopSpeechRecognition();
  }

  let recognition;
  try {
    recognition = new Recognition();
  } catch {
    return Promise.reject(createRecognitionError(
      'recognition-error',
      'Speech recognition could not be started. Please try again.',
    ));
  }

  recognition.lang = lang;
  recognition.interimResults = interimResults;
  recognition.continuous = continuous;
  recognition.maxAlternatives = 1;

  return new Promise((resolve, reject) => {
    let settled = false;
    let transcript = '';

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (activeRecognition === recognition) activeRecognition = null;

      if (error) {
        reject(error);
      } else if (transcript.trim()) {
        resolve(transcript.trim());
      } else {
        reject(getRecognitionError('no-speech'));
      }
    };

    activeRecognition = recognition;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) transcript += result[0]?.transcript || '';
      }
    };
    recognition.onerror = (event) => {
      const error = getRecognitionError(event.error);
      finish(error);
      try {
        recognition.abort();
      } catch {
        // The browser may already have ended the recognition session.
      }
    };
    recognition.onend = () => finish();

    try {
      recognition.start();
    } catch {
      finish(createRecognitionError(
        'recognition-error',
        'Speech recognition could not be started. Check microphone permissions and try again.',
      ));
    }
  });
}

/**
 * Stops the current recognition session.
 * Resolves once the browser has safely closed the session and released the microphone.
 */
export function stopSpeechRecognition() {
  const rec = activeRecognition;
  if (!rec) return Promise.resolve(false);

  return new Promise((resolve) => {
    activeRecognition = null;
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      resolve(true);
    };

    rec.onend = done;

    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        done();
      }
    }

    // Safety timeout in case browser does not fire onend
    setTimeout(done, 250);
  });
}