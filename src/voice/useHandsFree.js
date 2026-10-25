import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getRecognitionConstructor,
  isSpeechRecognitionSupported,
  stopSpeechRecognition,
  setActiveRecognition,
} from './speechInput';
import { parseWakePhrase, cleanCommandText, WAKE_PHRASE } from './wakeWord';
import { routeCommand } from '../actions/commandRouter';

/**
 * useHandsFree: Manages the hands-free voice control state machine and recognition lifecycle.
 *
 * States:
 * - 'off': Hands-free mode is disabled.
 * - 'starting': Microphone permission or recognition startup is pending.
 * - 'waiting-for-wake-word': Listening for "Hey Companion".
 * - 'listening-for-command': Wake phrase detected; listening for command.
 * - 'processing-command': A supported command is actively executing.
 * - 'error': A recoverable or terminal error occurred.
 *
 * @param {Object} params
 * @param {string} params.selectedLanguage Language code (e.g., 'en-IN')
 * @param {boolean} params.isSpeaking Whether speech synthesis is currently playing
 * @param {boolean} params.isManualListening Whether manual mic is currently listening
 * @param {Function} params.onExecuteCommand Async function to execute the routed command
 * @param {Function} [params.onStatusChange] Callback to update system status message
 */
export function useHandsFree({
  selectedLanguage = 'en-IN',
  isSpeaking = false,
  isManualListening = false,
  onExecuteCommand,
  onStatusChange,
}) {
  const [handsFreeState, setHandsFreeState] = useState('off');
  const [errorMessage, setErrorMessage] = useState('');

  // Refs for tracking mutable lifecycle state safely across async callbacks
  const stateRef = useRef('off');
  const isEnabledRef = useRef(false);
  const sessionIdRef = useRef(0);
  const recognitionRef = useRef(null);
  const commandTimeoutRef = useRef(null);
  const commandDeadlineRef = useRef(0);
  const restartTimerRef = useRef(null);
  const echoCooldownTimerRef = useRef(null);
  const micReadyTimerRef = useRef(null);
  const isSpeakingRef = useRef(isSpeaking);
  const prevSpeakingRef = useRef(isSpeaking);
  const isManualListeningRef = useRef(isManualListening);
  const isExecutingRef = useRef(false);
  const isAudioListeningRef = useRef(false);
  const lastExecutedRef = useRef({ text: '', timestamp: 0 });
  const restartHistoryRef = useRef([]);
  const isMountedRef = useRef(true);
  const instanceCounterRef = useRef(0);

  // Stable callback refs to prevent churn and cascading effect re-runs
  const onStatusChangeRef = useRef(onStatusChange);
  const onExecuteCommandRef = useRef(onExecuteCommand);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onExecuteCommandRef.current = onExecuteCommand;
  }, [onExecuteCommand]);

  const notifyStatus = useCallback((msg) => {
    if (typeof onStatusChangeRef.current === 'function') {
      onStatusChangeRef.current(msg);
    }
  }, []);

  const COMMAND_TIMEOUT_MS = 11000;

  // Sync stateRef with state
  const updateState = useCallback((newState) => {
    stateRef.current = newState;
    setHandsFreeState(newState);
  }, []);

  // Update refs when props change
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isManualListeningRef.current = isManualListening;
  }, [isManualListening]);

  // Command timeout management: ensures timeout is not cleared or restarted accidentally
  const clearCommandTimeout = useCallback(() => {
    if (commandTimeoutRef.current) {
      clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = null;
    }
    commandDeadlineRef.current = 0;
  }, []);

  const scheduleCommandTimeout = useCallback((durationMs) => {
    if (commandTimeoutRef.current) {
      clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = null;
    }
    const duration = Math.max(1000, durationMs || COMMAND_TIMEOUT_MS);
    commandDeadlineRef.current = Date.now() + duration;

    const currentSession = sessionIdRef.current;
    commandTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || sessionIdRef.current !== currentSession) return;
      if (stateRef.current === 'listening-for-command') {
        console.log(`[HandsFree] Command listening timed out after ${duration}ms [state: ${stateRef.current}]`);
        updateState('waiting-for-wake-word');
        notifyStatus(`Command listening timed out. Say “${WAKE_PHRASE}” when ready.`);
      }
    }, duration);
  }, [notifyStatus, updateState]);

  // Clean all timers
  const clearAllTimers = useCallback(() => {
    clearCommandTimeout();
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (echoCooldownTimerRef.current) {
      clearTimeout(echoCooldownTimerRef.current);
      echoCooldownTimerRef.current = null;
    }
    if (micReadyTimerRef.current) {
      clearTimeout(micReadyTimerRef.current);
      micReadyTimerRef.current = null;
    }
  }, [clearCommandTimeout]);

  // Safely stop the active recognition instance
  const stopRecognitionInstance = useCallback(() => {
    isAudioListeningRef.current = false;
    const rec = recognitionRef.current;
    if (rec) {
      recognitionRef.current = null;
      try {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch {
        // Recognition may have already ended
      }
      setActiveRecognition(null);
    }
  }, []);

  // Asynchronously stop recognition and await native browser release of the mic
  const stopRecognitionInstanceAsync = useCallback(() => {
    isAudioListeningRef.current = false;
    const rec = recognitionRef.current;
    if (!rec) {
      setActiveRecognition(null);
      return Promise.resolve();
    }
    recognitionRef.current = null;
    setActiveRecognition(null);

    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = done;

      try {
        rec.abort();
      } catch {
        done();
      }

      setTimeout(done, 200);
    });
  }, []);

  // Forward declare startRecognitionInstance
  const startRecognitionInstanceRef = useRef(null);

  // Execute a recognized voice command
  const executeRecognizedCommand = useCallback(async (commandText) => {
    if (!commandText || !commandText.trim()) return;

    const normalized = commandText.trim().toLowerCase();
    const now = Date.now();

    // Prevent duplicate command execution within 3500ms
    if (
      lastExecutedRef.current.text === normalized &&
      now - lastExecutedRef.current.timestamp < 3500
    ) {
      return;
    }
    if (isExecutingRef.current) {
      return;
    }

    lastExecutedRef.current = { text: normalized, timestamp: now };

    // Clear command timeout
    clearCommandTimeout();

    updateState('processing-command');
    isExecutingRef.current = true;

    // Temporarily stop microphone so speech synthesis and processing have full audio control
    stopRecognitionInstance();

    try {
      if (typeof onExecuteCommandRef.current === 'function') {
        await onExecuteCommandRef.current(commandText);
      }
    } catch (err) {
      console.error('Error executing voice command:', err);
    } finally {
      isExecutingRef.current = false;

      // After command completion and speech output, return to wake-word listening if hands-free remains enabled
      if (isEnabledRef.current && isMountedRef.current) {
        updateState('waiting-for-wake-word');
        notifyStatus(`Hands-Free active. Listening for “${WAKE_PHRASE}”...`);
        if (echoCooldownTimerRef.current) clearTimeout(echoCooldownTimerRef.current);
        echoCooldownTimerRef.current = setTimeout(() => {
          if (
            isEnabledRef.current &&
            !isSpeakingRef.current &&
            isMountedRef.current &&
            !isManualListeningRef.current
          ) {
            startRecognitionInstanceRef.current?.();
          }
        }, 400);
      }
    }
  }, [clearCommandTimeout, notifyStatus, stopRecognitionInstance, updateState]);

  // Start a single continuous recognition session
  const startRecognitionInstance = useCallback(() => {
    if (!isMountedRef.current || !isEnabledRef.current) return;
    if (isManualListeningRef.current || isSpeakingRef.current || isExecutingRef.current) return;

    // Check restart throttle: no more than 5 restarts in 5 seconds (exempt command listening)
    if (stateRef.current !== 'listening-for-command') {
      const now = Date.now();
      restartHistoryRef.current = restartHistoryRef.current.filter((ts) => now - ts < 5000);
      if (restartHistoryRef.current.length >= 5) {
        // Too frequent, back off for 2000ms
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (isMountedRef.current && isEnabledRef.current) {
            startRecognitionInstanceRef.current?.();
          }
        }, 2000);
        return;
      }
      restartHistoryRef.current.push(now);
    }

    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      updateState('error');
      setErrorMessage('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      isEnabledRef.current = false;
      return;
    }

    // Stop previous instance if any
    stopRecognitionInstance();

    const currentSession = sessionIdRef.current;
    instanceCounterRef.current += 1;
    const instanceId = instanceCounterRef.current;

    let recognition;
    try {
      recognition = new Recognition();
    } catch (err) {
      console.error(`[HandsFree #inst-${instanceId}] Failed to instantiate SpeechRecognition:`, err);
      updateState('error');
      setErrorMessage('Could not initialize speech recognition. Check microphone permissions.');
      isEnabledRef.current = false;
      return;
    }

    recognition.lang = selectedLanguage;
    recognition.continuous = true;
    recognition.interimResults = false; // Final results only to eliminate duplicate and phantom triggers
    recognition.maxAlternatives = 1;

    recognitionRef.current = recognition;
    setActiveRecognition(recognition);

    recognition.onstart = () => {
      if (!isMountedRef.current || sessionIdRef.current !== currentSession) return;
      isAudioListeningRef.current = true;
      console.log(`[HandsFree #inst-${instanceId}] onstart event fired. Microphone is capturing audio. [state: ${stateRef.current}]`);

      if (stateRef.current === 'starting' || stateRef.current === 'off') {
        updateState('waiting-for-wake-word');
        notifyStatus(`Hands-Free active. Listening for “${WAKE_PHRASE}”...`);
      } else if (stateRef.current === 'listening-for-command') {
        // Recognition is now verified active and listening for command
        if (micReadyTimerRef.current) {
          clearTimeout(micReadyTimerRef.current);
          micReadyTimerRef.current = null;
        }
        const remaining = commandDeadlineRef.current - Date.now();
        if (remaining <= 0) {
          updateState('waiting-for-wake-word');
          notifyStatus(`Command listening timed out. Say “${WAKE_PHRASE}” when ready.`);
        } else {
          // Guarantee user has at least 9 seconds of verified listening time after microphone is ACTUALLY live
          const effectiveTime = Math.max(remaining, 9000);
          scheduleCommandTimeout(effectiveTime);
          notifyStatus(`“${WAKE_PHRASE}” recognized! Microphone listening — speak your command (e.g. “Describe this image” or “Read text”)...`);
        }
      }
    };

    recognition.onresult = (event) => {
      if (!isMountedRef.current || sessionIdRef.current !== currentSession) return;
      if (isSpeakingRef.current || isExecutingRef.current) return;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        console.log(`[HandsFree #inst-${instanceId}] onresult index=${i} isFinal=${r.isFinal} transcript="${r[0]?.transcript}" [state: ${stateRef.current}]`);
      }

      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0]?.transcript || '';
        }
      }

      finalTranscript = finalTranscript.trim();
      if (!finalTranscript) return;

      const currentState = stateRef.current;

      // 1. If waiting for wake word: check if "Hey Companion" is present
      if (currentState === 'waiting-for-wake-word' || currentState === 'starting') {
        const { hasWakePhrase, command } = parseWakePhrase(finalTranscript);

        if (!hasWakePhrase) {
          // Unrelated speech, ignore safely
          return;
        }

        console.log(`[HandsFree #inst-${instanceId}] Wake phrase matched in transcript: "${finalTranscript}", extracted command: "${command}" [state: ${currentState}]`);

        // Wake phrase detected!
        if (command && command.trim().length > 0) {
          // Single-utterance style: "Hey Companion, describe this image"
          notifyStatus(`Wake word detected: "${command}". Processing...`);
          executeRecognizedCommand(command);
        } else {
          // Two-step style: "Hey Companion" alone -> enter command listening mode
          console.log(`[HandsFree #inst-${instanceId}] Transitioning into 'listening-for-command' [timeout: ${COMMAND_TIMEOUT_MS}ms]`);
          updateState('listening-for-command');
          scheduleCommandTimeout(COMMAND_TIMEOUT_MS);
          notifyStatus(`“${WAKE_PHRASE}” recognized! Preparing microphone for command...`);

          // If session stays alive and doesn't fire onend within 250ms, confirm mic listening
          if (micReadyTimerRef.current) clearTimeout(micReadyTimerRef.current);
          micReadyTimerRef.current = setTimeout(() => {
            if (
              isMountedRef.current &&
              stateRef.current === 'listening-for-command' &&
              isAudioListeningRef.current
            ) {
              notifyStatus(`“${WAKE_PHRASE}” recognized! Microphone listening — speak your command (e.g. “Describe this image” or “Read text”)...`);
            }
          }, 250);
        }
        return;
      }

      // 2. If listening for command: process the incoming utterance
      if (currentState === 'listening-for-command') {
        // Check if user repeated wake phrase alone or wake phrase + command
        const { hasWakePhrase, command: wakeCommand } = parseWakePhrase(finalTranscript);

        if (hasWakePhrase && wakeCommand && wakeCommand.trim().length > 0) {
          // User spoke "Hey Companion, [command]" in step 2
          const routed = routeCommand(wakeCommand, {
            hasImage: true,
            canUseCamera: true,
            visionAvailable: true,
            ocrAvailable: true,
            language: selectedLanguage,
          });

          if (routed.action !== 'unknown') {
            console.log(`[HandsFree #inst-${instanceId}] Command accepted: "${wakeCommand}" -> action: "${routed.action}" (status: "${routed.status}")`);
            clearCommandTimeout();
            notifyStatus(`Command received: "${wakeCommand}". Processing...`);
            executeRecognizedCommand(wakeCommand);
            return;
          }

          console.log(`[HandsFree #inst-${instanceId}] Voice question accepted: "${wakeCommand}" (action: unknown) -> forwarding to chatbot`);
          clearCommandTimeout();
          notifyStatus(`Question received: "${wakeCommand}". Processing...`);
          executeRecognizedCommand(wakeCommand);
          return;
        }

        if (hasWakePhrase && (!wakeCommand || wakeCommand.trim().length === 0)) {
          console.log(`[HandsFree #inst-${instanceId}] Wake phrase repeated. Refreshing deadline.`);
          const remaining = commandDeadlineRef.current - Date.now();
          const effectiveTime = Math.max(remaining, 8000);
          scheduleCommandTimeout(effectiveTime);
          notifyStatus(`"${WAKE_PHRASE}" heard. Listening for your question or command...`);
          return;
        }

        // Direct command utterance (e.g. "Describe this image", "Describe what you see", "Read text", "Read text from this image")
        const cleanedCommand = cleanCommandText(finalTranscript);
        if (!cleanedCommand) return;

        const routed = routeCommand(cleanedCommand, {
          hasImage: true,
          canUseCamera: true,
          visionAvailable: true,
          ocrAvailable: true,
          language: selectedLanguage,
        });

        if (routed.action !== 'unknown') {
          console.log(`[HandsFree #inst-${instanceId}] Command accepted: "${cleanedCommand}" -> action: "${routed.action}" (status: "${routed.status}")`);
          clearCommandTimeout();
          notifyStatus(`Command received: "${cleanedCommand}". Processing...`);
          executeRecognizedCommand(cleanedCommand);
          return;
        }

        console.log(`[HandsFree #inst-${instanceId}] Voice question accepted: "${cleanedCommand}" (action: unknown) -> forwarding to chatbot`);
        clearCommandTimeout();
        notifyStatus(`Question received: "${cleanedCommand}". Processing...`);
        executeRecognizedCommand(cleanedCommand);
        return;
      }
    };

    recognition.onerror = (event) => {
      if (!isMountedRef.current || sessionIdRef.current !== currentSession) return;
      isAudioListeningRef.current = false;
      const errorCode = event.error;
      console.log(`[HandsFree #inst-${instanceId}] onerror event: "${errorCode}" [state: ${stateRef.current}]`);

      // Recoverable: no speech detected during browser's silence window
      if (errorCode === 'no-speech' || errorCode === 'aborted') {
        return;
      }

      // Terminal / Permission errors
      if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
        updateState('error');
        setErrorMessage('Microphone permission was denied. Allow microphone access in your browser to use Hands-Free mode.');
        isEnabledRef.current = false;
        stopRecognitionInstance();
        notifyStatus('Microphone access denied. Hands-Free mode turned off.');
        return;
      }

      if (errorCode === 'audio-capture') {
        // Transient error during rapid restart or device switch in command listening
        if (stateRef.current === 'listening-for-command') {
          const remaining = commandDeadlineRef.current - Date.now();
          if (remaining > 1500) {
            console.warn(`[HandsFree #inst-${instanceId}] Transient audio-capture error during command listening; restarting...`);
            return;
          }
        }
        updateState('error');
        setErrorMessage('No microphone detected. Connect or enable a microphone and try again.');
        isEnabledRef.current = false;
        stopRecognitionInstance();
        notifyStatus('No microphone available.');
        return;
      }

      if (errorCode === 'network') {
        updateState('error');
        setErrorMessage('Speech recognition network error. Check your internet connection.');
        isEnabledRef.current = false;
        stopRecognitionInstance();
        notifyStatus('Speech network error.');
        return;
      }

      console.warn(`[HandsFree #inst-${instanceId}] Speech recognition warning/error:`, errorCode);
    };

    recognition.onend = () => {
      isAudioListeningRef.current = false;
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      setActiveRecognition(null);
      console.log(`[HandsFree #inst-${instanceId}] onend event fired. [state: ${stateRef.current}, isAudioListening: ${isAudioListeningRef.current}]`);

      if (!isMountedRef.current || sessionIdRef.current !== currentSession) return;
      if (!isEnabledRef.current || stateRef.current === 'off' || stateRef.current === 'error') return;
      if (isManualListeningRef.current || isSpeakingRef.current || isExecutingRef.current) return;

      // Check if in listening-for-command and whether deadline has expired
      if (stateRef.current === 'listening-for-command') {
        if (micReadyTimerRef.current) {
          clearTimeout(micReadyTimerRef.current);
          micReadyTimerRef.current = null;
        }
        const remaining = commandDeadlineRef.current - Date.now();
        if (remaining <= 0) {
          updateState('waiting-for-wake-word');
          notifyStatus(`Command listening timed out. Say “${WAKE_PHRASE}” when ready.`);
        } else {
          notifyStatus(`“${WAKE_PHRASE}” recognized! Re-arming microphone for command...`);
        }
      }

      // Safe restart delay to ensure Chrome releases the audio capture stream cleanly
      const restartDelay = stateRef.current === 'listening-for-command' ? 50 : 300;
      console.log(`[HandsFree #inst-${instanceId}] Recognition restart scheduled in ${restartDelay}ms [state: ${stateRef.current}]`);

      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (
          isMountedRef.current &&
          isEnabledRef.current &&
          !isManualListeningRef.current &&
          !isSpeakingRef.current &&
          !isExecutingRef.current
        ) {
          console.log(`[HandsFree #inst-${instanceId}] Recognition restart timer completed. Calling startRecognitionInstance... [state: ${stateRef.current}]`);
          startRecognitionInstanceRef.current?.();
        }
      }, restartDelay);
    };

    try {
      console.log(`[HandsFree #inst-${instanceId}] SpeechRecognition instance created. Calling recognition.start() [state: ${stateRef.current}, lang: ${selectedLanguage}]`);
      recognition.start();
    } catch (err) {
      console.warn(`[HandsFree #inst-${instanceId}] recognition.start() threw exception:`, err);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      const retryDelay = stateRef.current === 'listening-for-command' ? 100 : 600;
      restartTimerRef.current = setTimeout(() => {
        if (isMountedRef.current && isEnabledRef.current && !isManualListeningRef.current) {
          startRecognitionInstanceRef.current?.();
        }
      }, retryDelay);
    }
  }, [
    clearCommandTimeout,
    executeRecognizedCommand,
    notifyStatus,
    scheduleCommandTimeout,
    selectedLanguage,
    stopRecognitionInstance,
    updateState,
  ]);

  // Keep ref up to date inside an effect
  useEffect(() => {
    startRecognitionInstanceRef.current = startRecognitionInstance;
  }, [startRecognitionInstance]);

  // React to assistant speaking state changes (Acoustic Echo Protection)
  useEffect(() => {
    const wasSpeaking = prevSpeakingRef.current;
    prevSpeakingRef.current = isSpeaking;

    // ONLY react when isSpeaking actually transitions
    if (wasSpeaking === isSpeaking) return;
    if (!isEnabledRef.current || stateRef.current === 'off' || stateRef.current === 'error') return;

    if (isSpeaking) {
      // Assistant started speaking: stop microphone immediately to prevent acoustic echo
      stopRecognitionInstance();
    } else if (wasSpeaking && !isSpeaking) {
      // Assistant finished speaking: resume listening for wake word after echo cooldown
      if (!isManualListeningRef.current && !isExecutingRef.current) {
        updateState('waiting-for-wake-word');
        if (echoCooldownTimerRef.current) clearTimeout(echoCooldownTimerRef.current);
        echoCooldownTimerRef.current = setTimeout(() => {
          if (isMountedRef.current && isEnabledRef.current && !isSpeakingRef.current && !isManualListeningRef.current) {
            notifyStatus(`Hands-Free active. Listening for “${WAKE_PHRASE}”...`);
            startRecognitionInstanceRef.current?.();
          }
        }, 450);
      }
    }
  }, [isSpeaking, notifyStatus, stopRecognitionInstance, updateState]);

  // Public: Start Hands-Free Mode
  const startHandsFree = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      updateState('error');
      setErrorMessage('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    // Stop manual mic if it was active
    stopSpeechRecognition();

    isEnabledRef.current = true;
    sessionIdRef.current += 1;
    clearAllTimers();
    setErrorMessage('');
    updateState('starting');

    notifyStatus(`Starting Hands-Free mode. Listening for “${WAKE_PHRASE}”...`);
    startRecognitionInstance();
  }, [clearAllTimers, notifyStatus, startRecognitionInstance, updateState]);

  // Public: Stop Hands-Free Mode
  const stopHandsFree = useCallback((updateStatusText = true) => {
    isEnabledRef.current = false;
    sessionIdRef.current += 1;
    clearAllTimers();
    stopRecognitionInstance();
    setErrorMessage('');
    updateState('off');

    if (updateStatusText) {
      notifyStatus('Hands-Free mode turned off.');
    }
  }, [clearAllTimers, notifyStatus, stopRecognitionInstance, updateState]);

  // Public: Toggle Hands-Free Mode
  const toggleHandsFree = useCallback(() => {
    if (isEnabledRef.current) {
      stopHandsFree(true);
    } else {
      startHandsFree();
    }
  }, [startHandsFree, stopHandsFree]);

  // Public: Pause Hands-Free temporarily (e.g. when manual mic button is clicked)
  const pauseForManualMic = useCallback(async () => {
    clearAllTimers();
    await stopRecognitionInstanceAsync();
  }, [clearAllTimers, stopRecognitionInstanceAsync]);

  // Public: Resume Hands-Free after manual mic completes
  const resumeAfterManualMic = useCallback(() => {
    if (!isEnabledRef.current || !isMountedRef.current) return;
    updateState('waiting-for-wake-word');
    notifyStatus(`Hands-Free active. Listening for “${WAKE_PHRASE}”...`);
    if (echoCooldownTimerRef.current) clearTimeout(echoCooldownTimerRef.current);
    echoCooldownTimerRef.current = setTimeout(() => {
      if (isEnabledRef.current && isMountedRef.current && !isManualListeningRef.current && !isSpeakingRef.current) {
        startRecognitionInstanceRef.current?.();
      }
    }, 400);
  }, [notifyStatus, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      sessionIdRef.current += 1;
      clearAllTimers();
      stopRecognitionInstance();
    };
  }, [clearAllTimers, stopRecognitionInstance]);

  return {
    handsFreeState,
    isEnabled: handsFreeState !== 'off',
    errorMessage,
    startHandsFree,
    stopHandsFree,
    toggleHandsFree,
    pauseForManualMic,
    resumeAfterManualMic,
  };
}
