/**
 * MicButton: Accessible, prominent primary interaction button for voice activation.
 * 
 * Props:
 * - onClick: Function to handle button click
 * - disabled: Boolean indicating if button is disabled
 * - label: Descriptive string for the accessible aria-label
 */
export default function MicButton({
  onClick,
  disabled = false,
  label = 'Start voice interaction',
  isListening = false,
}) {
  return (
    <div className="mic-button-wrapper">
      <button
        type="button"
        className="mic-button"
        onClick={onClick}
        disabled={disabled}
        aria-label={isListening ? 'Stop listening' : label}
        aria-pressed={isListening}
        title={isListening ? 'Stop listening' : label}
      >
        {/* Crisp inline SVG Microphone Icon with explicit non-focusable state */}
        <svg
          className="mic-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </button>
    </div>
  );
}
