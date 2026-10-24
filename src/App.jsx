import React, { useState } from 'react';
import MicButton from './components/MicButton';
import CameraPanel from './components/CameraPanel';
import ChatPanel from './components/ChatPanel';
import StatusBar from './components/StatusBar';
import { loadVision, describeImage, isVisionReady } from './ai/vision';

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
  const [status, setStatus] = useState('Select an image to get started.');
  const [progress, setProgress] = useState(null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);

  // Microphone interaction handler
  const handleMicClick = () => {
    setStatus('Voice input is not available yet.');
  };

  // Status updates from child components (e.g., image selection feedback)
  const handleStatusChange = (newStatus) => {
    setStatus(newStatus);
  };

  // Image change handler from CameraPanel (stores selected File or null)
  const handleImageChange = (file) => {
    setSelectedImage(file);
  };

  // Vision description handler
  const handleDescribeImage = async (imageFile, customQuestion) => {
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

    // Post user command to conversation history
    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: questionText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      // Lazy-load model if not already loaded into worker
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
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: description || '(Model did not return a description.)',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error('Vision inference error:', err);
      const errorMsg = err.message || 'An unexpected error occurred during image description.';
      setStatus(`Error: ${errorMsg}`);
      setProgress(null);
      setIsDescribing(false);

      const errorMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: `Could not describe image: ${errorMsg}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
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
              label="Activate microphone (Voice input is not available yet)"
            />

            <div>
              <p className="voice-instruction">Tap the microphone to interact.</p>
              <p className="voice-subtext">
                Speech recognition is currently in development and not active yet.
              </p>
            </div>

            {/* Exactly one polite status region on the page */}
            <StatusBar
              status={status}
              isLoading={isDescribing}
              progress={progress}
            />
          </section>

          {/* 2. Scene & Document Reading Section (DOM Order: Second in main) */}
          <CameraPanel
            onImageChange={handleImageChange}
            onStatusChange={handleStatusChange}
            onDescribe={handleDescribeImage}
            isDescribing={isDescribing}
          />

          {/* 3. Conversation Panel Section (DOM Order: Third in main) */}
          <ChatPanel messages={messages} />
        </div>
      </main>

      {/* Accessible Supporting Footer */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-container">
          <p className="footer-note">
            Personal AI Companion is built for screen-reader and keyboard accessibility. Voice, OCR, and AI models are in active development.
          </p>
          <p className="footer-version">v0.1.0 • Foundation UI</p>
        </div>
      </footer>
    </div>
  );
}
