import { useEffect, useRef } from 'react';

/**
 * ChatPanel: Clean, accessible conversation area with empty state and example commands.
 * 
 * Props:
 * - messages: Array of message objects [{ id, sender: 'user' | 'assistant', text, timestamp }]
 */
export default function ChatPanel({ messages = [] }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);
  const examplePrompts = [
    {
      id: 'example-1',
      text: 'Describe something in front of me.',
      icon: (
        <svg className="example-prompt-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
    {
      id: 'example-2',
      text: 'Read text from an image.',
      icon: (
        <svg className="example-prompt-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      id: 'example-3',
      text: 'Open YouTube.',
      icon: (
        <svg className="example-prompt-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </svg>
      ),
    },
  ];

  return (
    <section className="chat-panel" aria-labelledby="chat-heading">
      <header className="chat-panel-header">
        <h2 id="chat-heading" className="chat-panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Conversation
        </h2>
        <span className="chat-badge">
          {messages.length === 0 ? 'No active chat' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
        </span>
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
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <div className="empty-state-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <h3 className="empty-state-heading">No messages yet</h3>
            <p className="empty-state-desc">
              Spoken commands and assistant replies will appear here after you use the microphone.
            </p>

            <div className="example-prompts-section">
              <span className="example-prompts-label">Example voice commands</span>
              <ul className="example-prompts-list" aria-label="List of planned voice commands">
                {examplePrompts.map((prompt) => (
                  <li key={prompt.id} className="example-prompt-chip">
                    {prompt.icon}
                    <span>“{prompt.text}”</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <article
              key={msg.id}
              className={`chat-message chat-message--${msg.sender === 'user' ? 'user' : 'assistant'}`}
            >
              <span className="message-sender">
                {msg.sender === 'user' ? 'You' : (msg.label || 'Assistant')}
              </span>
              <div className="message-bubble">
                {msg.text}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
