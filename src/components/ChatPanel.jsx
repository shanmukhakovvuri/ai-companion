import { useState, useEffect, useRef } from 'react';

/**
 * ChatPanel: Accessible conversation area matching the Framer reference design.
 * 
 * Props:
 * - messages: Array of message objects [{ id, sender: 'user' | 'assistant', text, timestamp, label }]
 * - onSendMessage: Callback invoked with trimmed user message string
 * - isGenerating: Boolean indicating whether model download or text generation is active
 * - chatStatus: Optional status message (e.g. 'Downloading chat model: 45%')
 * - chatProgress: Optional integer percentage (0-100)
 * - chatError: Optional error message string
 */
export default function ChatPanel({
  messages = [],
  onSendMessage,
  isGenerating = false,
  chatStatus = null,
  chatProgress = null,
  chatError = null,
}) {
  const containerRef = useRef(null);
  const textareaRef = useRef(null);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isGenerating, chatStatus]);

  const hasMessages = messages.length > 0;

  const handleSubmit = (event) => {
    if (event) event.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isGenerating) return;

    if (typeof onSendMessage === 'function') {
      onSendMessage(trimmed);
      setInputText('');
    }
  };

  const handleKeyDown = (event) => {
    // Send on Enter without Shift; Shift+Enter creates a newline
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  return (
    <section className="chat-panel" aria-labelledby="chat-heading">
      <header className="chat-panel-header">
        <h2 id="chat-heading" className="chat-panel-title">
          Your conversation
        </h2>
        <p className="chat-panel-subtitle">
          {hasMessages
            ? `${messages.length} message${messages.length === 1 ? '' : 's'}`
            : 'No messages yet'}
        </p>
      </header>

      {/* Accessible conversation feed with live region scoped strictly to message list */}
      <div
        ref={containerRef}
        className="chat-messages-container"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
      >
        {!hasMessages ? (
          <div className="chat-empty-state">
            <p className="chat-empty-text">
              No messages yet. Start a conversation using the microphone or type below.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <article
              key={msg.id}
              className={`chat-message chat-message--${msg.sender === 'user' ? 'user' : 'assistant'}`}
            >
              <span className="message-sender">
                {msg.sender === 'user' ? 'You' : (msg.label || 'Companion')}
              </span>
              <div className="message-bubble">
                {msg.text}
              </div>
            </article>
          ))
        )}

        {isGenerating && (
          <article
            className="chat-message chat-message--assistant"
            aria-live="polite"
            aria-label="Companion is thinking"
          >
            <span className="message-sender">Companion</span>
            <div className="message-bubble chat-generating-bubble">
              {chatStatus || 'Generating response...'}
              {typeof chatProgress === 'number' && ` (${chatProgress}%)`}
            </div>
          </article>
        )}
      </div>

      <div className="chat-speech-status">
        {chatError ? (
          <span style={{ color: 'var(--color-status-error, #f44336)' }}>{chatError}</span>
        ) : (
          'Speech output is available for responses.'
        )}
      </div>

      <hr className="chat-divider" />

      {/* Message input section */}
      <form className="chat-input-section" onSubmit={handleSubmit}>
        <label htmlFor="chat-text-input" className="chat-input-label">
          Or type your message
        </label>
        <textarea
          ref={textareaRef}
          id="chat-text-input"
          className="chat-textarea"
          rows={3}
          placeholder={isGenerating ? "Companion is generating a response..." : "Ask your companion a question or type a message..."}
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          aria-describedby="chat-privacy-note"
        />
        <div className="chat-input-actions">
          <button
            type="submit"
            className="btn-send-message"
            disabled={isGenerating || !inputText.trim()}
            aria-busy={isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Send message'}
          </button>
        </div>
        <p id="chat-privacy-note" className="chat-input-note">
          On-device AI · 100% private in your browser · No API keys required
        </p>
      </form>
    </section>
  );
}
