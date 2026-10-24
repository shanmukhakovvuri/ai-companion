import React from 'react';

/**
 * StatusBar: Displays system state and accessible feedback.
 * This is the application's single polite live region (role="status").
 * 
 * Props:
 * - status: String message describing current status
 * - isLoading: Optional boolean indicating an active background process
 * - progress: Optional number (0-100) indicating process completion
 */
export default function StatusBar({ status = 'Voice input is not available yet.', isLoading = false, progress = null }) {
  // Determine semantic tone without relying exclusively on color
  const statusLower = status.toLowerCase();
  
  let statusType = 'info';
  if (statusLower.includes('ready')) {
    statusType = 'ready';
  } else if (statusLower.includes('not available') || statusLower.includes('invalid') || statusLower.includes('error')) {
    statusType = 'warn';
  }

  return (
    <div
      className={`status-bar status-bar--${statusType}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={isLoading}
    >
      <span className="status-bar-icon-wrap" aria-hidden="true">
        {statusType === 'ready' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {statusType === 'warn' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
        {statusType === 'info' && (
          <span className="status-bar-dot" aria-hidden="true" />
        )}
      </span>

      <span className="status-bar-text">
        {status}
      </span>

      {progress !== null && (
        <span className="status-bar-progress" aria-label={`Progress: ${progress}%`}>
          {progress}%
        </span>
      )}
    </div>
  );
}
