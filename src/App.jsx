import { useEffect, useState, useRef } from 'react';
import MicButton from './components/MicButton';
import CameraPanel from './components/CameraPanel';
import ChatPanel from './components/ChatPanel';
import StatusBar from './components/StatusBar';
import { loadVision, describeImage, isVisionReady } from './ai/vision';
import { loadOcr, readText, isOcrReady } from './ai/ocr';
import { isSpeechRecognitionSupported, startSpeechRecognition, stopSpeechRecognition } from './voice/speechInput';
import { speakText as speakSpeechOutput, stopSpeaking as stopSpeechOutput } from './voice/speechOutput';
import { speakText, stopSpeaking, pauseSpeaking, resumeSpeaking } from './voice/speak';
import { openAllowedSite, routeCommand } from './actions/commandRouter';
import { isTextGroundedQuestion, answerImageQuestion } from './ai/qa';

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

  const handleMicClick = async () => {
    if (isListening) {
      stopSpeechRecognition();
      setStatus('Stopping speech recognition...');
      return;
    }
    if (isProcessingVoice || isDescribing || isReadingText) return;

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

      const result = routeCommand(transcript, {
        hasImage: Boolean(selectedImage),
        visionAvailable: typeof describeImage === 'function',
        ocrAvailable: typeof readText === 'function',
        language: selectedLanguage,
      });

      if (result.action === 'describe_image' && result.status === 'ready') {
        await handleDescribeImage(selectedImage, transcript);
        return;
      }

      if (result.action === 'read_text' && result.status === 'ready') {
        await handleReadText(selectedImage);
        return;
      }

      addMessage('user', transcript);
      addMessage('assistant', result.message);

      if (result.action === 'open_site' && result.status === 'ready') {
        await speakResponse(result.message, 'Command completed successfully.');
        openAllowedSite(result.params.siteId);
      } else {
        const completionStatus = result.status === 'unavailable'
          ? 'Feature unavailable.'
          : result.status === 'needs_input'
            ? 'Image needed.'
            : 'Response ready.';
        await speakResponse(result.message, completionStatus);
      }
    } catch (error) {
      setIsListening(false);
      const errorMessage = error.message || 'Speech recognition failed. Please try again.';
      setStatus(error.code === 'unsupported'
        ? 'Speech recognition is not available in this browser. Try Chrome or Edge.'
        : `Error: ${errorMessage}`);
    } finally {
      setIsListening(false);
      setIsProcessingVoice(false);
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

          speakText(groundedAnswer, {
            onStart: () => {
              setIsSpeaking(true);
              setIsPaused(false);
            },
            onEnd: () => {
              setIsSpeaking(false);
              setIsPaused(false);
            },
            onError: () => {
              setIsSpeaking(false);
              setIsPaused(false);
            },
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
        speakText(description, {
          onStart: () => {
            setIsSpeaking(true);
            setIsPaused(false);
          },
          onEnd: () => {
            setIsSpeaking(false);
            setIsPaused(false);
          },
          onError: () => {
            setIsSpeaking(false);
            setIsPaused(false);
          },
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
      speakText(text, {
        onStart: () => {
          setIsSpeaking(true);
          setIsPaused(false);
        },
        onEnd: () => {
          setIsSpeaking(false);
          setIsPaused(false);
        },
        onError: () => {
          setIsSpeaking(false);
          setIsPaused(false);
        },
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
            <div className="brand-icon" aria-hidden="true">
              {/* Soundwave/spark brand mark */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M12 2v20M17 5v14M7 8v8M22 10v4M2 10v4" />
              </svg>
            </div>
            <div className="brand-text">
              {/* Single h1 for the entire page */}
              <h1 className="brand-title">Personal AI <span>Companion</span></h1>
              <p className="brand-subtitle">Your voice-first assistant</p>
            </div>
          </div>

          {/* Plain availability indicator (NOT a live region to avoid duplicate screen-reader chatter) */}
          <div className="header-availability" aria-hidden="true">
            <span className="availability-dot" />
            <span>Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content Landmark */}
      <main id="main-content" className="app-main" tabIndex={-1}>
        <div className="layout-grid">
          {/* 1. Voice Hero Section (DOM Order: First in main) */}
          <section className="voice-hero-card" aria-labelledby="voice-heading">
            <h2 id="voice-heading" className="voice-hero-title">Voice Interaction</h2>

            <MicButton
              onClick={handleMicClick}
              label="Start speech recognition"
              isListening={isListening}
              disabled={isProcessingVoice || isDescribing || isReadingText}
            />

            <div className="voice-controls" role="group" aria-label="Voice settings and playback controls">
              <div className="voice-language-control">
                <label htmlFor="voice-language">Speech language</label>
                <select
                  id="voice-language"
                  value={selectedLanguage}
                  onChange={(event) => setSelectedLanguage(event.target.value)}
                  disabled={isListening || isProcessingVoice || isDescribing || isReadingText}
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
                Stop speaking
              </button>
            </div>

            <div>
              <p className="voice-instruction">{isListening ? 'Listening. Speak a command.' : 'Activate the microphone to speak.'}</p>
              <p className="voice-subtext">The microphone button also stops listening. Speech is handled by your browser.</p>
            </div>

            {/* Exactly one polite status region on the page */}
            <StatusBar
              status={status}
              isLoading={isDescribing || isReadingText || isProcessingVoice}
              progress={progress}
            />
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
          />

          {/* 3. Conversation Panel Section (DOM Order: Third in main) */}
          <ChatPanel messages={messages} />
        </div>
      </main>

      {/* Accessible Supporting Footer */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-container">
          <p className="footer-note">
            Personal AI Companion supports keyboard and screen-reader access. Voice input, OCR, and AI models run in your browser.
          </p>
          <p className="footer-version">v0.1.0 • Foundation UI</p>
        </div>
      </footer>
    </div>
  );
}
