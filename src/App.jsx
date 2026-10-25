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
    const fileToProcess = imageFile || selectedImage;

    if (!fileToProcess) {
      setStatus('Please select or capture an image first.');
      return;
    }

    if (isReadingText || isDescribing) return;

    stopSpeechOutput();
    stopSpeaking();
    setIsSpeaking(false);
    setIsPaused(false);
    setIsReadingText(true);
    setProgress(null);

    addMessage('user', 'Read text from this image.');

    try {
      if (!isOcrReady()) {
        setStatus('Initializing OCR engine...');
        let lastMilestone = -1;

        await loadOcr((percent) => {
          const milestones = [0, 25, 50, 75, 100];
          let currentMilestone = -1;

          for (const milestone of milestones) {
            if (percent >= milestone) currentMilestone = milestone;
          }

          if (currentMilestone !== -1 && currentMilestone !== lastMilestone) {
            lastMilestone = currentMilestone;
            setProgress(currentMilestone);
            setStatus(`Loading OCR engine: ${currentMilestone}%`);
          }
        });
      }

      setProgress(null);
      setStatus('Reading text from image...');

      const { text, confidence } = await readText(fileToProcess);
      currentOcrCacheRef.current = { file: fileToProcess, text, confidence };

      if (!text?.trim()) {
        addMessage('assistant', 'No readable text was found. Try a clearer image.');
        setStatus('No readable text found.');
        return;
      }

      let formattedText = text.trim();

      if (typeof confidence === 'number' && confidence < 60) {
        formattedText +=
          '\n\nThis text may contain mistakes. Please double-check important details.';
      }

      addMessage('assistant', formattedText, 'Text found in image');
      setStatus('Text reading complete.');

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
    } catch (error) {
      console.error('OCR recognition error:', error);
      const errorMessage =
        error.message || 'This image could not be read. Try another image.';

      setStatus(`Error: ${errorMessage}`);
      addMessage('assistant', `Could not read text: ${errorMessage}`);
    } finally {
      setIsReadingText(false);
      setProgress(null);
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
            Preview · Not connected
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
                disabled={isProcessingVoice || isDescribing || isReadingText}
              />
            </div>

            <div className="voice-card-content-col">
              <h2 id="voice-heading" className="voice-hero-title">
                {isListening ? 'Listening now...' : 'Ready when you are'}
              </h2>
              <p className="voice-instruction">
                {isListening ? 'Speak a command or ask a question.' : 'Start voice input, or use the message field below.'}
              </p>
              <p className="voice-subtext">
                The microphone button starts and stops listening. Speech is handled by your browser.
              </p>
              {/* Exactly one polite status region on the page */}
              <StatusBar
                status={status}
                isLoading={isDescribing || isReadingText || isProcessingVoice}
                progress={progress}
              />
            </div>

            <div className="voice-card-controls-col" role="group" aria-label="Voice settings and playback controls">
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
                Stop speech
              </button>
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
          />
          {/* 3. Conversation Panel Section (DOM Order: Third in main) */}
          <ChatPanel messages={messages} />
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
