import { useState, useEffect, useRef } from 'react';

/**
 * ChatPanel: Accessible conversation area matching the Framer reference design.
 * 
 * Props:
 * - messages: Array of message objects [{ id, sender: 'user' | 'assistant', text, timestamp, label }]
 */
export default function ChatPanel({
  messages = [],
  onSendMessage,
  isSending = false,
  isDisabled = false,
  chatStatus = '',
}) {
  const containerRef = useRef(null);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const hasMessages = messages.length > 0;
  const canSend = Boolean(inputText.trim()) && !isSending && !isDisabled;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canSend || !onSendMessage) return;
    onSendMessage(inputText.trim());
    setInputText('');
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
              No messages yet. Start with the microphone or type a message below.
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
        Spoken replies are available for voice and image actions.
      </div>

      <hr className="chat-divider" />

      <form className="chat-input-section" onSubmit={handleSubmit}>
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
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={isSending || isDisabled}
          aria-describedby="chat-input-note chat-status-note"
        />
        <div className="chat-input-actions">
          <button
            type="button"
            className="btn-send-message"
            disabled={!canSend}
            aria-disabled={!canSend}
            onClick={handleSubmit}
          >
            {isSending ? 'Generating...' : 'Send message'}
          </button>
        </div>
        <p id="chat-input-note" className="chat-input-note">
          Replies use the Qwen model in your browser. First use downloads about 483 MB on WebGPU or 786 MB on WASM.
        </p>
        <p id="chat-status-note" className="chat-generation-status" role="status" aria-live="polite" aria-atomic="true" aria-busy={isSending}>
          {chatStatus || (isSending ? 'Preparing your response...' : '')}
        </p>
      </form>
    </section>
  );
}
