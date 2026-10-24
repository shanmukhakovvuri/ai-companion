import React, { useState, useEffect, useRef } from 'react';

/**
 * CameraPanel: Accessible interface for image capture, upload, preview, and image action controls.
 * 
 * Props:
 * - onImageChange: Callback invoked with the selected File object or null
 * - onStatusChange: Callback invoked with status descriptions for user feedback
 */
export default function CameraPanel({
  onImageChange,
  onStatusChange,
  onDescribe,
  onReadText,
  isDescribing = false,
  isReadingText = false,
  isSpeaking = false,
  isPaused = false,
  onPauseReading,
  onResumeReading,
  onStopReading,
  statusText = '',
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [question, setQuestion] = useState('');
  const [validationError, setValidationError] = useState(null);
  const fileInputRef = useRef(null);

  const hasImage = Boolean(selectedFile);
  const isBusy = isDescribing || isReadingText;
  const canDescribe = hasImage && !isBusy;
  const canReadText = hasImage && !isBusy;

  // Clean up object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate that the chosen file is a valid image type
    if (!file.type || !file.type.startsWith('image/')) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      setValidationError('Please select a valid image file (JPEG, PNG, WebP, GIF).');
      if (onImageChange) onImageChange(null);
      if (onStatusChange) onStatusChange('Invalid file type. Please choose an image.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Revoke previous URL if one exists
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
    setValidationError(null);

    if (onImageChange) onImageChange(file);
    if (onStatusChange) onStatusChange('Image selected. Click "Describe" to analyze with local AI.');
  };

  const handleClearImage = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setQuestion('');
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (onImageChange) onImageChange(null);
    if (onStatusChange) onStatusChange('Image removed. Select an image to get started.');
  };

  const handleRotateImage = async () => {
    if (!selectedFile || !previewUrl || isBusy) return;
    try {
      const img = new Image();
      img.src = previewUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const mimeType = selectedFile.type || 'image/jpeg';
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));
      if (!blob) return;

      const rotatedFile = new File([blob], selectedFile.name, { type: mimeType });
      const newUrl = URL.createObjectURL(rotatedFile);

      URL.revokeObjectURL(previewUrl);
      setSelectedFile(rotatedFile);
      setPreviewUrl(newUrl);

      if (onImageChange) onImageChange(rotatedFile);
      if (onStatusChange) onStatusChange('Image rotated 90 degrees clockwise.');
    } catch (err) {
      console.error('Failed to rotate image:', err);
    }
  };

  const handleTriggerInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <section className="camera-panel" aria-labelledby="camera-heading">
      <header className="camera-panel-header">
        <h2 id="camera-heading" className="camera-panel-title">
          <svg className="camera-panel-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          Scene & Document Reading
        </h2>
      </header>

      {/* Validation Error Banner linked via aria-describedby and role="alert" */}
      {validationError && (
        <div id="camera-validation-error" className="camera-error-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{validationError}</span>
        </div>
      )}

      {/* Accessible File Input */}
      <input
        ref={fileInputRef}
        type="file"
        id="camera-file-input"
        className="file-input-hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        aria-label="Upload an image or take a photo"
        aria-invalid={validationError ? 'true' : 'false'}
        aria-describedby={validationError ? 'camera-validation-error camera-upload-hint' : 'camera-upload-hint'}
      />

      {/* Upload Dropzone or Image Preview */}
      {!previewUrl ? (
        <label
          htmlFor="camera-file-input"
          className="upload-dropzone"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTriggerInput();
            }
          }}
        >
          <div className="upload-icon-wrapper" aria-hidden="true">
            <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <p className="upload-primary-text">
              <span>Choose an image</span> or take a photo
            </p>
            <p id="camera-upload-hint" className="upload-secondary-text">
              PNG, JPG, or WebP up to 10MB
            </p>
          </div>
        </label>
      ) : (
        <div className="preview-container">
          <div className="image-preview-wrapper">
            <img
              src={previewUrl}
              alt={selectedFile ? `Preview of the selected image: ${selectedFile.name}` : 'Preview of the selected image'}
              className="image-preview"
            />
          </div>

          <div className="preview-controls">
            <span className="preview-file-info" title={selectedFile?.name}>
              {selectedFile?.name}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-replace-image"
                onClick={handleRotateImage}
                aria-label="Rotate image 90 degrees clockwise"
                title="Rotate image 90° clockwise"
                disabled={isBusy}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                Rotate
              </button>
              <button
                type="button"
                className="btn-replace-image"
                onClick={handleTriggerInput}
                aria-label="Replace current image"
                disabled={isBusy}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Replace
              </button>
              <button
                type="button"
                className="btn-replace-image"
                onClick={handleClearImage}
                aria-label="Clear current image"
                disabled={isBusy}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Clear
              </button>
            </div>
          </div>

          {/* Optional Question Box */}
          <div className="camera-question-wrapper">
            <label htmlFor="camera-question-input" className="camera-question-label">
              <span>Ask about this photo</span>
              <span className="camera-question-optional">(optional)</span>
            </label>
            <input
              id="camera-question-input"
              type="text"
              className="camera-question-input"
              placeholder="Ask a question about this photo (optional)"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={isBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canDescribe && onDescribe) {
                    const trimmed = question.trim();
                    onDescribe(selectedFile, trimmed.length > 0 ? trimmed : 'Describe this image in detail.');
                  }
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Camera Action Buttons (Focusable with aria-disabled and visible explanations) */}
      <div className="camera-actions-grid" role="group" aria-label="Visual AI actions">
        <div>
          <button
            type="button"
            className={`btn-camera-action ${canDescribe ? 'btn-camera-action--active' : ''}`}
            aria-disabled={!canDescribe}
            aria-busy={isDescribing}
            aria-describedby="describe-explanation"
            onClick={(e) => {
              if (canDescribe && onDescribe) {
                const trimmed = question.trim();
                onDescribe(selectedFile, trimmed.length > 0 ? trimmed : 'Describe this image in detail.');
              } else {
                e.preventDefault();
              }
            }}
          >
            <span className="camera-action-label">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              {isDescribing ? 'Describing...' : 'Describe'}
            </span>
            <span className="camera-action-badge" aria-hidden="true">
              {isDescribing ? 'Processing' : (hasImage ? 'Ready' : 'Requires image')}
            </span>
          </button>
          <span id="describe-explanation" className="action-help-text">
            {isDescribing
              ? (statusText || 'Analyzing image with local AI...')
              : (hasImage
                  ? 'Describe this photo using local AI.'
                  : 'Select or take a photo first to enable AI description.')}
          </span>
        </div>

        <div>
          <button
            type="button"
            className={`btn-camera-action ${canReadText ? 'btn-camera-action--active' : ''}`}
            aria-disabled={!canReadText}
            aria-busy={isReadingText}
            aria-describedby="read-text-explanation"
            onClick={(e) => {
              if (canReadText && onReadText) {
                onReadText(selectedFile);
              } else {
                e.preventDefault();
              }
            }}
          >
            <span className="camera-action-label">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <polyline points="4 7 4 4 20 4 20 7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
              {isReadingText ? 'Reading...' : 'Read text'}
            </span>
            <span className="camera-action-badge" aria-hidden="true">
              {isReadingText ? 'Processing' : (hasImage ? 'Ready' : 'Requires image')}
            </span>
          </button>
          <span id="read-text-explanation" className="action-help-text">
            {isReadingText
              ? (statusText || 'Extracting text from image...')
              : (hasImage
                  ? 'Extract and read printed or written text from this photo.'
                  : 'Select or take a photo first to read text.')}
          </span>
        </div>
      </div>

      {/* Accessible Speech Playback Controls (Pause / Resume / Stop) */}
      {(isSpeaking || isPaused) && (
        <div className="speech-controls-group" role="group" aria-label="Speech playback controls">
          {isSpeaking && !isPaused ? (
            <button
              type="button"
              className="btn-pause-reading"
              onClick={onPauseReading}
              aria-label="Pause reading text aloud"
            >
              <svg className="speech-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              <span>Pause</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-resume-reading"
              onClick={onResumeReading}
              aria-label="Resume reading text aloud"
            >
              <svg className="speech-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Resume</span>
            </button>
          )}

          <button
            type="button"
            className="btn-stop-reading"
            onClick={onStopReading}
            aria-label="Stop reading text aloud"
          >
            <svg className="btn-stop-reading-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            <span>Stop reading</span>
          </button>
        </div>
      )}
    </section>
  );
}
