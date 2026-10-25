import { useState, useEffect, useRef } from 'react';

/**
 * ChatPanel: Accessible conversation area matching the Framer reference design.
 * 
 * Props:
 * - messages: Array of message objects [{ id, sender: 'user' | 'assistant', text, timestamp, label }]
 */
export default function ChatPanel({ messages = [] }) {
  const containerRef = useRef(null);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const hasMessages = messages.length > 0;

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
              No messages yet. Start a conversation using the microphone.
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
      </div>

      <div className="chat-speech-status">
        Speech output is available for responses.
      </div>

      <hr className="chat-divider" />

      {/* Message input section (Preview only, awaiting Gemini integration) */}
      <div className="chat-input-section">
        <label htmlFor="chat-text-input" className="chat-input-label">
          Or type your message
        </label>
        <textarea
          id="chat-text-input"
          className="chat-textarea"
          rows={3}
          placeholder="Ask your companion..."
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          aria-describedby="chat-preview-note"
        />
        <div className="chat-input-actions">
          <button
            type="button"
            className="btn-send-message"
            disabled
            aria-disabled="true"
            title="Message sending is preview-only until Gemini integration is connected"
          >
            Send message
          </button>
        </div>
        <p id="chat-preview-note" className="chat-input-note">
          Preview only · Connect to your existing chatbot
        </p>
      </div>
    </section>
  );
}
