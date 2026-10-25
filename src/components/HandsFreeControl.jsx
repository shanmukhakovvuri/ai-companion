/**
 * HandsFreeControl: Accessible UI control for Hands-Free Mode with wake-phrase detection.
 *
 * Wake Phrase: "Hey Companion"
 *
 * States:
 * - 'off': Feature is disabled.
 * - 'starting': Microphone permission or recognition startup is pending.
 * - 'waiting-for-wake-word': Listening for "Hey Companion".
 * - 'listening-for-command': Wake phrase detected; waiting for command.
 * - 'processing-command': Executing command.
 * - 'error': Error occurred (permission denied, unsupported browser, etc.).
 *
 * Props:
 * - handsFreeState: Current state string
 * - isEnabled: Boolean indicating if hands-free is enabled
 * - onToggle: Callback function when toggle button is clicked
 * - disabled: Boolean indicating if toggle is disabled (e.g. during processing)
 * - errorMessage: Optional error message string
 */
export default function HandsFreeControl({
  handsFreeState = 'off',
  isEnabled = false,
  onToggle,
  disabled = false,
  errorMessage = '',
}) {
  // Label and badge styling based on state
  let stateLabel = 'Off';
  let badgeModifier = 'off';
  let hintText = 'Say “Hey Companion” to activate without clicking.';

  if (handsFreeState === 'starting') {
    stateLabel = 'Starting...';
    badgeModifier = 'starting';
    hintText = 'Connecting to microphone...';
  } else if (handsFreeState === 'waiting-for-wake-word') {
    stateLabel = 'Listening for wake word';
    badgeModifier = 'listening';
    hintText = 'Waiting for “Hey Companion”';
  } else if (handsFreeState === 'listening-for-command') {
    stateLabel = 'Wake phrase heard!';
    badgeModifier = 'command';
    hintText = 'Say a command like “Describe this image” or “Read text”';
  } else if (handsFreeState === 'processing-command') {
    stateLabel = 'Processing command...';
    badgeModifier = 'processing';
    hintText = 'Executing your requested operation...';
  } else if (handsFreeState === 'error') {
    stateLabel = 'Notice';
    badgeModifier = 'error';
    hintText = errorMessage || 'Could not start Hands-Free mode.';
  }

  return (
    <div className="handsfree-control-card" role="region" aria-label="Hands-free assistant control">
      <div className="handsfree-header-row">
        <div className="handsfree-label-group">
          <span className="handsfree-title">Hands-Free Mode</span>
          <span
            className={`handsfree-badge handsfree-badge--${badgeModifier}`}
            aria-live="polite"
          >
            {stateLabel}
          </span>
        </div>

        <button
          type="button"
          className={`handsfree-toggle-btn ${isEnabled ? 'handsfree-toggle-btn--active' : ''}`}
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={isEnabled}
          aria-label={isEnabled ? 'Turn off Hands-Free Mode' : 'Turn on Hands-Free Mode'}
          title={isEnabled ? 'Disable Hands-Free Mode immediately' : 'Enable Hands-Free Mode with wake word “Hey Companion”'}
        >
          {/* Wave / audio indicator icon */}
          <svg
            className="handsfree-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {isEnabled ? (
              // Active: Soundwave icon
              <>
                <path d="M2 10v4" />
                <path d="M6 7v10" />
                <path d="M10 4v16" />
                <path d="M14 7v10" />
                <path d="M18 10v4" />
                <path d="M22 12v0" />
              </>
            ) : (
              // Inactive: Mic with diagonal slash or off wave
              <>
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </>
            )}
          </svg>
          <span>{isEnabled ? 'Turn off' : 'Turn on'}</span>
        </button>
      </div>

      <p className="handsfree-hint" aria-live="polite">
        {hintText}
      </p>

      {handsFreeState === 'error' && errorMessage && (
        <p className="handsfree-error-alert" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
