# Voice Modules (`src/voice`)

- `speechInput.js` exports `isSpeechRecognitionSupported()`, `startSpeechRecognition(options)`, and `stopSpeechRecognition()`. Listening starts only when the caller explicitly invokes the start function.
- `speechOutput.js` exports `speakText(text, options)` and `stopSpeaking()` for browser-native spoken responses.

Both modules use browser APIs only. Recognition support and errors are reported to the caller; the app modules do not save transcripts or send them to an app backend. The browser's speech recognition provider may process audio, depending on browser and settings.
