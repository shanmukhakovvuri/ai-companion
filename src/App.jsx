import { useEffect, useState, useRef } from 'react';
import MicButton from './components/MicButton';
import CameraPanel from './components/CameraPanel';
import ChatPanel from './components/ChatPanel';
import StatusBar from './components/StatusBar';
import { loadVision, describeImage, isVisionReady } from './ai/vision';
import { loadOcr, readText, isOcrReady } from './ai/ocr';
import { loadChat, generateChat, isChatReady } from './ai/chat';
import { isSpeechRecognitionSupported, startSpeechRecognition, stopSpeechRecognition } from './voice/speechInput';
import { speakText as speakSpeechOutput, stopSpeaking as stopSpeechOutput } from './voice/speechOutput';
import { speakText, stopSpeaking, pauseSpeaking, resumeSpeaking } from './voice/speak';
import { openAllowedSite, routeCommand } from './actions/commandRouter';
import { isTextGroundedQuestion, answerImageQuestion } from './ai/qa';
import HandsFreeControl from './components/HandsFreeControl';
import { useHandsFree } from './voice/useHandsFree';

const VOICE_LANGUAGES = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'Hindi (India)' },
  { value: 'te-IN', label: 'Telugu (India)' },
];

/**
 * App: Accessible layout and state-orchestration layer for Personal AI Companion.
 * 
 * Strict Screen-Reader Reading Order:
 * 1. Skip link
 * 2. Header (single h1)
 * 3. Main content:
 *    - Voice Interaction Section (h2)
 *    - Scene & Document Reading Section (CameraPanel h2)
 *    - Conversation Section (ChatPanel h2)
 * 4. Footer
 */
export default function App() {
  const [status, setStatus] = useState(() => (
    isSpeechRecognitionSupported()
      ? 'Ready. Choose a language and activate the microphone.'
      : 'Speech recognition is not available in this browser. Try Chrome or Edge.'
  ));
  const [progress, setProgress] = useState(null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isReadingText, setIsReadingText] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [messages, setMessages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en-IN');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const currentOcrCacheRef = useRef(null);
  const [isGeneratingChat, setIsGeneratingChat] = useState(false);
  const [chatStatus, setChatStatus] = useState(null);
  const [chatProgress, setChatProgress] = useState(null);
  const [chatError, setChatError] = useState(null);

  // Webcam refs — CameraPanel writes into these so voice commands can access the camera
  const captureFrameRef = useRef(null);
  const isCameraActiveRef = useRef(false);
  const startCameraRef = useRef(null);

  useEffect(() => () => {
    stopSpeechRecognition();
    stopSpeechOutput();
    stopSpeaking();
  }, []);

  const addMessage = (sender, text, label) => {
    setMessages((prev) => [...prev, {
      id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender,
      text,
      label,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
  };

  const speakResponse = async (text, completionStatus = 'Response ready.') => {
    if (!text?.trim()) return;
    stopSpeaking();
    setIsSpeaking(true);
    setIsPaused(false);
    setStatus('Speaking response...');
    try {
      const finished = await speakSpeechOutput(text, { lang: selectedLanguage });
      if (finished) setStatus(completionStatus);
    } catch (error) {
      setStatus(`Error: ${error.message || 'Spoken response could not be played.'}`);
    } finally {
      setIsSpeaking(false);
    }
  };

  const executeCommand = async (transcript) => {
    if (!transcript || !transcript.trim()) return;
    await handleSendMessage(transcript, { viaVoice: true });
  };

  const {
    handsFreeState,
    isEnabled: isHandsFreeEnabled,
    errorMessage: handsFreeError,
    toggleHandsFree,
    pauseForManualMic,
    resumeAfterManualMic,
  } = useHandsFree({
    selectedLanguage,
    isSpeaking,
    isManualListening: isListening,
    onExecuteCommand: executeCommand,
    onStatusChange: setStatus,
  });

  const handleMicClick = async () => {
    if (isListening) {
      await stopSpeechRecognition();
      setStatus('Speech recognition stopped.');
      return;
    }
    if (isProcessingVoice || isDescribing || isReadingText || isGeneratingChat) return;

    // Temporarily pause hands-free recognition and await full release of the microphone
    await pauseForManualMic();

    stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);
    setStatus(`Starting speech recognition in ${selectedLanguage}...`);
    setIsListening(true);

    try {
      const recognition = startSpeechRecognition({ lang: selectedLanguage });
      setStatus(`Listening in ${selectedLanguage}. Speak a command.`);
      const transcript = await recognition;
      setIsListening(false);
      setIsProcessingVoice(true);

      await executeCommand(transcript);
    } catch (error) {
      setIsListening(false);
      if (error.code === 'aborted') {
        setStatus('Speech recognition stopped.');
        return;
      }
      if (error.code === 'no-speech') {
        setStatus('No speech detected. Activate the microphone to try again.');
        return;
      }
      const errorMessage = error.message || 'Speech recognition failed. Please try again.';
      setStatus(error.code === 'unsupported'
        ? 'Speech recognition is not available in this browser. Try Chrome or Edge.'
        : `Error: ${errorMessage}`);
    } finally {
      setIsListening(false);
      setIsProcessingVoice(false);
      // Resume hands-free if it was enabled
      resumeAfterManualMic();
    }
  };

  const handleStopSpeaking = () => {
    const stopped = stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);
    if (stopped) {
      setStatus('Spoken response stopped.');
    } else {
      setStatus('Speech stopped.');
    }
  };

  // Status updates from child components (e.g., image selection feedback)
  const handleStatusChange = (newStatus) => {
    setStatus(newStatus);
  };

  // Image change handler from CameraPanel (stores selected File or null)
  const handleImageChange = (file) => {
    setSelectedImage(file);
    // Invalidate OCR cache for previously selected image
    currentOcrCacheRef.current = null;
    // Cancel any active speech if image changes
    stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);
  };

  // Stop reading handler
  const handleStopReading = () => {
    stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);
    setStatus('Speech stopped.');
  };

  // Pause reading handler
  const handlePauseReading = () => {
    pauseSpeaking();
    setIsPaused(true);
    setStatus('Speech paused.');
  };

  // Resume reading handler
  const handleResumeReading = () => {
    resumeSpeaking();
    setIsPaused(false);
    setStatus('Resuming speech...');
  };

  // Vision description / grounded question answering handler
  const handleDescribeImage = async (imageFile, customQuestion) => {
    // Cancel any speech currently in progress
    stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);

    const fileToProcess = imageFile || selectedImage;
    if (!fileToProcess) {
      setStatus('Please select or capture an image first.');
      return;
    }

    const questionText = (typeof customQuestion === 'string' && customQuestion.trim().length > 0)
      ? customQuestion.trim()
      : 'Describe this image in detail.';

    setIsDescribing(true);
    setProgress(null);

    addMessage('user', questionText);

    try {
      // 1. Grounded OCR Check for document text queries (phone numbers, names, addresses)
      if (isTextGroundedQuestion(questionText)) {
        let ocrText = '';
        if (currentOcrCacheRef.current && currentOcrCacheRef.current.file === fileToProcess) {
          ocrText = currentOcrCacheRef.current.text;
        } else {
          setStatus('Reading document text to answer your question...');
          if (!isOcrReady()) {
            await loadOcr();
          }
          const ocrRes = await readText(fileToProcess);
          ocrText = ocrRes.text;
          currentOcrCacheRef.current = { file: fileToProcess, text: ocrRes.text, confidence: ocrRes.confidence };
        }

        const groundedAnswer = answerImageQuestion(questionText, ocrText);
        if (groundedAnswer) {
          setStatus('Text ready');
          setIsDescribing(false);

          addMessage('assistant', groundedAnswer);

          await new Promise((resolve) => {
            speakText(groundedAnswer, {
              onStart: () => {
                setIsSpeaking(true);
                setIsPaused(false);
              },
              onEnd: () => {
                setIsSpeaking(false);
                setIsPaused(false);
                resolve();
              },
              onError: () => {
                setIsSpeaking(false);
                setIsPaused(false);
                resolve();
              },
            });
          });
          return;
        }
      }

      // 2. Visual scene reasoning: Use local vision model
      if (!isVisionReady()) {
        setStatus('Preparing vision model in browser...');
        await loadVision((percent) => {
          setProgress(percent);
          setStatus(`Downloading vision model: ${percent}%`);
        });
      }

      // Run inference
      setProgress(null);
      setStatus('Analyzing image with local AI...');

      const description = await describeImage(fileToProcess, questionText);

      setStatus('Image description ready.');
      setIsDescribing(false);

      // Post assistant response to conversation history
      const response = description || '(Model did not return a description.)';
      addMessage('assistant', response);

      if (description) {
        await new Promise((resolve) => {
          speakText(description, {
            onStart: () => {
              setIsSpeaking(true);
              setIsPaused(false);
            },
            onEnd: () => {
              setIsSpeaking(false);
              setIsPaused(false);
              resolve();
            },
            onError: () => {
              setIsSpeaking(false);
              setIsPaused(false);
              resolve();
            },
          });
        });
      }
    } catch (err) {
      console.error('Vision/QA error:', err);
      const errorMsg = err.message || 'An unexpected error occurred during image processing.';
      setStatus(`Error: ${errorMsg}`);
      setProgress(null);
      setIsDescribing(false);

      const response = `Could not describe image: ${errorMsg}`;
      addMessage('assistant', response);
      await speakResponse(response, 'Image description failed.');
    }
  };

  // OCR Read Text handler
  const handleReadText = async (imageFile) => {
    // 1. Cancel any speech currently in progress
    stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);

    const fileToProcess = imageFile || selectedImage;
    if (!fileToProcess) {
      setStatus('Please select or capture an image first.');
      return;
    }

    setIsReadingText(true);
    setProgress(null);

    // Post user request to conversation
    addMessage('user', 'Read text from this image.');

    try {
      // 2. Lazy-load OCR worker if not ready, announcing milestone progress
      if (!isOcrReady()) {
        setStatus('Initializing OCR engine...');
        let lastMilestone = -1;
        const milestones = [0, 25, 50, 75, 100];

        await loadOcr((percent) => {
          let currentMilestone = -1;
          for (const m of milestones) {
            if (percent >= m) {
              currentMilestone = m;
            }
          }

          if (currentMilestone !== -1 && currentMilestone !== lastMilestone) {
            lastMilestone = currentMilestone;
            setProgress(currentMilestone);
            setStatus(`Loading OCR engine: ${currentMilestone}%`);
          }
        });

        // Announce "Text ready" when worker finishes loading
        setProgress(null);
        setStatus('Text ready');
      }

      setProgress(null);

      // 3. Run recognition
      const { text, confidence } = await readText(fileToProcess);
      currentOcrCacheRef.current = { file: fileToProcess, text, confidence };

      setIsReadingText(false);

      // Announce ONLY "Text ready" in the status region after recognition completes
      setStatus('Text ready');

      if (!text) {
        addMessage('assistant', 'No text was found in this image.', 'Text found in image');
        return;
      }

      // If confidence below ~60, append warning
      let formattedText = text;
      if (confidence < 60) {
        formattedText += '\n\nThis text may contain mistakes. Please double-check anything important, such as medicine instructions.';
      }

      addMessage('assistant', formattedText, 'Text found in image');

      // 4. Speak recognized text sequentially with chunking
      await new Promise((resolve) => {
        speakText(text, {
          onStart: () => {
            setIsSpeaking(true);
            setIsPaused(false);
          },
          onEnd: () => {
            setIsSpeaking(false);
            setIsPaused(false);
            resolve();
          },
          onError: () => {
            setIsSpeaking(false);
            setIsPaused(false);
            resolve();
          },
        });
      });
    } catch (err) {
      console.error('OCR recognition error:', err);
      const errorMsg = err.message || 'This image could not be read. Try another image.';
      setStatus(`Error: ${errorMsg}`);
      setProgress(null);
      setIsReadingText(false);

      addMessage('assistant', errorMsg, 'Text found in image');
    }
  };

  // Conversational AI message handler (both typed messages and conversational speech)
  const handleSendMessage = async (text, { viaVoice = false } = {}) => {
    const trimmed = text?.trim();
    if (!trimmed || isGeneratingChat) return;

    // Check if either an uploaded image, active camera, or callable camera starter is available
    const canUseCamera = Boolean(startCameraRef.current) || isCameraActiveRef.current;

    // Route explicit commands (describe image, read text, open site)
    const result = routeCommand(trimmed, {
      hasImage: Boolean(selectedImage),
      canUseCamera,
      visionAvailable: typeof describeImage === 'function',
      ocrAvailable: typeof readText === 'function',
      language: selectedLanguage,
    });

    if (result.action === 'describe_image' && result.status === 'ready') {
      let imageToProcess = selectedImage;
      if (!imageToProcess) {
        if (!isCameraActiveRef.current && startCameraRef.current) {
          setStatus('Activating camera...');
          try {
            await startCameraRef.current();
          } catch (err) {
            const errNotice = err.message || 'Camera permission denied or camera unavailable.';
            setStatus(errNotice);
            await speakResponse('Camera could not be started. Please allow camera access or upload an image.', 'Camera startup failed.');
            return;
          }
        }
        if (captureFrameRef.current) {
          setStatus('Capturing frame from camera...');
          imageToProcess = await captureFrameRef.current();
        }
      }

      if (imageToProcess) {
        await handleDescribeImage(imageToProcess, trimmed);
      } else {
        setStatus('Could not capture a frame from the camera.');
        await speakResponse('Could not capture a frame from the camera. Please make sure the camera is running.', 'Camera capture failed.');
      }
      return;
    }

    if (result.action === 'read_text' && result.status === 'ready') {
      let imageToProcess = selectedImage;
      if (!imageToProcess) {
        if (!isCameraActiveRef.current && startCameraRef.current) {
          setStatus('Activating camera...');
          try {
            await startCameraRef.current();
          } catch (err) {
            const errNotice = err.message || 'Camera permission denied or camera unavailable.';
            setStatus(errNotice);
            await speakResponse('Camera could not be started. Please allow camera access or upload an image.', 'Camera startup failed.');
            return;
          }
        }
        if (captureFrameRef.current) {
          setStatus('Capturing frame from camera...');
          imageToProcess = await captureFrameRef.current();
        }
      }

      if (imageToProcess) {
        await handleReadText(imageToProcess);
      } else {
        setStatus('Could not capture a frame from the camera.');
        await speakResponse('Could not capture a frame from the camera. Please make sure the camera is running.', 'Camera capture failed.');
      }
      return;
    }

    if (result.action === 'open_site' && result.status === 'ready') {
      try {
        const openRes = openAllowedSite(result.params.siteId, { inNewTab: result.params.inNewTab ?? true });
        if (openRes.success) {
          addMessage('user', trimmed);
          addMessage('assistant', result.message);
          setStatus('Command completed successfully.');
          if (viaVoice) {
            await speakResponse(result.message, 'Command completed successfully.');
          }
        } else if (openRes.popupBlocked) {
          const blockedMsg = `Could not open ${result.params.siteId === 'youtube' ? 'YouTube' : 'Google'} because the browser blocked the popup. Please allow popups for this site, or visit ${openRes.url}`;
          addMessage('user', trimmed);
          addMessage('assistant', blockedMsg);
          setStatus('Popup blocked by browser.');
          if (viaVoice) {
            await speakResponse('The browser blocked opening the new tab. Please allow popups.', 'Popup blocked.');
          }
        }
      } catch (err) {
        const errMsg = `Failed to open website: ${err.message || err}`;
        addMessage('user', trimmed);
        addMessage('assistant', errMsg);
        setStatus(`Error: ${errMsg}`);
      }
      return;
    }

    if (result.status === 'unsupported') {
      addMessage('user', trimmed);
      addMessage('assistant', result.message);
      setStatus('Action unsupported.');
      if (viaVoice) {
        await speakResponse(result.message, 'Action unsupported.');
      }
      return;
    }

    if (result.status === 'needs_input') {
      addMessage('user', trimmed);
      addMessage('assistant', result.message);
      setStatus('Image needed.');
      if (viaVoice) {
        await speakResponse(result.message, 'Image needed.');
      }
      return;
    }

    // If an image is selected and user asked a grounded question about it
    if (selectedImage && isTextGroundedQuestion(trimmed)) {
      await handleDescribeImage(selectedImage, trimmed);
      return;
    }

    // Conversational text generation via in-browser model
    addMessage('user', trimmed);
    setIsGeneratingChat(true);
    setChatError(null);

    try {
      if (!isChatReady()) {
        setStatus('Loading local AI chat model (Qwen2.5-0.5B)...');
        setChatStatus('Downloading chat model (first load may take a moment)...');
        await loadChat((percent) => {
          setChatProgress(percent);
          setChatStatus(`Downloading chat model: ${percent}%`);
          setStatus(`Downloading chat model: ${percent}%`);
        });
      }

      setChatProgress(null);
      setChatStatus('Generating response...');
      setStatus('Generating response with local AI...');

      const response = await generateChat(trimmed, messages);
      const answer = response || '(No response generated)';

      addMessage('assistant', answer);
      setStatus('Response ready.');

      if (viaVoice) {
        await speakResponse(answer, 'Response ready.');
      }
    } catch (err) {
      console.error('Chat generation error:', err);
      const errorMsg = err.message || 'Failed to generate response.';
      setChatError(errorMsg);
      setStatus(`Error: ${errorMsg}`);
      addMessage('assistant', `Could not generate response: ${errorMsg}`);
      if (viaVoice) {
        await speakResponse(`Could not generate response: ${errorMsg}`, 'Chat error.');
      }
    } finally {
      setIsGeneratingChat(false);
      setChatStatus(null);
      setChatProgress(null);
    }
  };

  return (
    <div className="app-root">
      {/* Skip to Main Content Link for Keyboard and Screen-Reader Users */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Product Header */}
      <header className="app-header" role="banner">
        <div className="header-container">
          <div className="brand-section">
            <div className="brand-text">
              <span className="brand-title">Personal AI Companion</span>
              <p className="brand-subtitle">Your voice-first accessibility assistant</p>
            </div>
          </div>

          {/* Plain preview / connection status indicator */}
          <div className="header-preview-status" aria-hidden="true">
            {isChatReady() ? 'Local AI · Ready' : 'Local AI · In-Browser'}
          </div>
        </div>
      </header>

      {/* Main Content Landmark */}
      <main id="main-content" className="app-main" tabIndex={-1}>
        {/* Hero Introduction */}
        <section className="hero-intro" aria-labelledby="hero-heading">
          <h1 id="hero-heading" className="hero-title">
            A little help. More independence.
          </h1>
          <p className="hero-subtitle">
            Ask a question, explore an image, or read a document. Start with your voice.
          </p>
        </section>

        <div className="layout-grid">
          {/* 1. Voice Hero Section (DOM Order: First in main) */}
          <section className="voice-hero-card" aria-labelledby="voice-heading">
            <div className="voice-card-mic-col">
              <MicButton
                onClick={handleMicClick}
                label="Start speech recognition"
                isListening={isListening}
                disabled={isProcessingVoice || isDescribing || isReadingText || isGeneratingChat}
              />
            </div>

            <div className="voice-card-content-col">
              <h2 id="voice-heading" className="voice-hero-title">
                {isListening
                  ? 'Listening now...'
                  : handsFreeState === 'waiting-for-wake-word'
                    ? 'Listening for “Hey Companion”'
                    : handsFreeState === 'listening-for-command'
                      ? 'Listening for command...'
                      : handsFreeState === 'processing-command'
                        ? 'Processing command...'
                        : 'Ready when you are'}
              </h2>
              <p className="voice-instruction">
                {isListening
                  ? 'Speak a command or ask a question.'
                  : handsFreeState === 'waiting-for-wake-word'
                    ? 'Say “Hey Companion” followed by “Describe this image” or “Read text”.'
                    : handsFreeState === 'listening-for-command'
                      ? 'Say “Describe this image”, “Read text”, or “Open YouTube”.'
                      : 'Start voice input, or use hands-free mode on the right.'}
              </p>
              <p className="voice-subtext">
                The microphone button starts and stops listening. Speech is handled by your browser.
              </p>
              {/* Exactly one polite status region on the page */}
              <StatusBar
                status={status}
                isLoading={isDescribing || isReadingText || isProcessingVoice || isGeneratingChat}
                progress={progress !== null ? progress : chatProgress}
              />
            </div>

            <div className="voice-card-controls-col" role="group" aria-label="Voice settings and playback controls">
              <div className="voice-language-control">
                <label htmlFor="voice-language">Speech language</label>
                <select
                  id="voice-language"
                  value={selectedLanguage}
                  onChange={(event) => setSelectedLanguage(event.target.value)}
                  disabled={isListening || isProcessingVoice || isDescribing || isReadingText || isHandsFreeEnabled}
                >
                  {VOICE_LANGUAGES.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="voice-stop-button"
                onClick={handleStopSpeaking}
                disabled={!isSpeaking}
                aria-label="Stop spoken response"
              >
                Stop speech
              </button>

              <HandsFreeControl
                handsFreeState={handsFreeState}
                isEnabled={isHandsFreeEnabled}
                onToggle={toggleHandsFree}
                disabled={isProcessingVoice || isDescribing || isReadingText || isGeneratingChat}
                errorMessage={handsFreeError}
              />
            </div>
          </section>

          {/* 2. Scene & Document Reading Section (DOM Order: Second in main) */}
          <CameraPanel
            onImageChange={handleImageChange}
            onStatusChange={handleStatusChange}
            onDescribe={handleDescribeImage}
            onReadText={handleReadText}
            isDescribing={isDescribing}
            isReadingText={isReadingText}
            isSpeaking={isSpeaking}
            isPaused={isPaused}
            onPauseReading={handlePauseReading}
            onResumeReading={handleResumeReading}
            onStopReading={handleStopReading}
            statusText={status}
            captureFrameRef={captureFrameRef}
            isCameraActiveRef={isCameraActiveRef}
            startCameraRef={startCameraRef}
          />

          {/* 3. Conversation Panel Section (DOM Order: Third in main) */}
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isGenerating={isGeneratingChat}
            chatStatus={chatStatus}
            chatProgress={chatProgress}
            chatError={chatError}
          />
        </div>
      </main>

      {/* Accessible Supporting Footer */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-container">
          <p className="footer-note">
            Personal AI Companion · University project / Interface preview
          </p>
        </div>
      </footer>
    </div>
  );
}
