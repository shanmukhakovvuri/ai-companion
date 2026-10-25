import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * CameraPanel: Accessible interface for image capture, upload, webcam preview,
 * and image action controls.
 * Matches Framer reference design for "Images & documents".
 *
 * Props:
 * - onImageChange: Callback invoked with the selected File object or null
 * - onStatusChange: Callback invoked with status descriptions for user feedback
 * - onDescribe: Callback to describe image with vision model
 * - onReadText: Callback to extract text with OCR
 * - isDescribing: Boolean indicating vision processing
 * - isReadingText: Boolean indicating OCR processing
 * - isSpeaking: Boolean indicating speech synthesis playing
 * - isPaused: Boolean indicating speech playback paused
 * - onPauseReading: Callback to pause speech
 * - onResumeReading: Callback to resume speech
 * - onStopReading: Callback to stop speech
 * - statusText: Optional status text
 * - captureFrameRef: A React ref — CameraPanel writes a captureFrame() function
 *   into it so the parent can capture a single frame from the live webcam.
 * - isCameraActiveRef: A React ref — CameraPanel writes the current camera-active
 *   boolean into it so the parent can check without causing re-renders.
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
  captureFrameRef,
  isCameraActiveRef,
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [question, setQuestion] = useState('');
  const [validationError, setValidationError] = useState(null);
  const fileInputRef = useRef(null);

  // ── Webcam state ──
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const hasImage = Boolean(selectedFile);
  const isBusy = isDescribing || isReadingText;
  const canDescribe = (hasImage || isCameraActive) && !isBusy;
  const canReadText = (hasImage || isCameraActive) && !isBusy;

  // ── Keep parent's isCameraActiveRef in sync ──
  useEffect(() => {
    if (isCameraActiveRef) {
      isCameraActiveRef.current = isCameraActive;
    }
  }, [isCameraActive, isCameraActiveRef]);

  // ── Capture a single frame from the live webcam ──
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.readyState < 2) {
      return null; // Video not ready
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], 'webcam-frame.jpg', { type: 'image/jpeg' }));
          } else {
            resolve(null);
          }
        },
        'image/jpeg',
        0.92
      );
    });
  }, []);

  // ── Expose captureFrame to parent via ref ──
  useEffect(() => {
    if (captureFrameRef) {
      captureFrameRef.current = captureFrame;
    }
  }, [captureFrame, captureFrameRef]);

  // ── Start the webcam ──
  const startCamera = useCallback(async () => {
    // Prevent duplicates
    if (streamRef.current) return;

    setCameraError('');

    // Check browser support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Your browser does not support camera access. Try Chrome or Edge.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false, // Never request microphone here
      });

      streamRef.current = stream;
      setIsCameraActive(true);

      // Attach stream to video element after state update causes it to render
      // We use a small timeout to let React render the <video> element first
      requestAnimationFrame(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
        }
      });

      if (onStatusChange) {
        onStatusChange('Camera started. Say "Describe this image" or "Read text" to analyze the live view.');
      }
    } catch (err) {
      console.error('Camera access error:', err);
      streamRef.current = null;
      setIsCameraActive(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera was found on this device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError('Camera is in use by another application. Close it and try again.');
      } else {
        setCameraError(`Could not start camera: ${err.message || 'Unknown error'}`);
      }
    }
  }, [onStatusChange]);

  // ── Stop the webcam ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setCameraError('');

    if (onStatusChange) {
      onStatusChange('Camera stopped.');
    }
  }, [onStatusChange]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

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
    if (onStatusChange) onStatusChange('Image selected. Click "Describe" or "Read text" to analyze.');
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

  // ── Handle Describe button with webcam fallback ──
  const handleDescribeClick = async () => {
    if (isBusy || !onDescribe) return;

    const trimmed = question.trim();
    const prompt = trimmed.length > 0 ? trimmed : 'Describe this image in detail.';

    // Prefer uploaded image; fall back to webcam frame
    if (selectedFile) {
      onDescribe(selectedFile, prompt);
    } else if (isCameraActive) {
      const frame = await captureFrame();
      if (frame) {
        onDescribe(frame, prompt);
      } else if (onStatusChange) {
        onStatusChange('Could not capture a frame from the camera. Make sure the camera is running.');
      }
    }
  };

  // ── Handle Read Text button with webcam fallback ──
  const handleReadTextClick = async () => {
    if (isBusy || !onReadText) return;

    if (selectedFile) {
      onReadText(selectedFile);
    } else if (isCameraActive) {
      const frame = await captureFrame();
      if (frame) {
        onReadText(frame);
      } else if (onStatusChange) {
        onStatusChange('Could not capture a frame from the camera. Make sure the camera is running.');
      }
    }
  };

  return (
    <section className="camera-panel" aria-labelledby="camera-heading">
      <header className="camera-panel-header">
        <h2 id="camera-heading" className="camera-panel-title">
          Images & documents
        </h2>
        <p className="camera-panel-subtitle">
          Understand a scene or hear printed text.
        </p>
      </header>

      {/* Validation Error Banner */}
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

      {/* Camera Error Banner */}
      {cameraError && (
        <div className="camera-error-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{cameraError}</span>
        </div>
      )}

      {/* ── Live Webcam Preview ── */}
      {isCameraActive && (
        <div className="webcam-preview-container">
          <div className="webcam-preview-wrapper">
            <video
              ref={videoRef}
              className="webcam-preview-video"
              autoPlay
              playsInline
              muted
              aria-label="Live webcam preview"
            />
          </div>
          <p className="webcam-preview-label">Live camera preview</p>
        </div>
      )}

      {/* Webcam Start / Stop Controls */}
      <div className="webcam-controls" role="group" aria-label="Webcam controls">
        {!isCameraActive ? (
          <button
            type="button"
            className="btn-webcam-control btn-webcam-start"
            onClick={startCamera}
            disabled={isBusy}
            aria-label="Start live camera preview"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Start camera
          </button>
        ) : (
          <button
            type="button"
            className="btn-webcam-control btn-webcam-stop"
            onClick={stopCamera}
            aria-label="Stop live camera and release resources"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            Stop camera
          </button>
        )}
      </div>

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
        aria-describedby={validationError ? 'camera-validation-error' : undefined}
      />

      {/* Image Preview or "No image selected" empty box */}
      {!previewUrl ? (
        !isCameraActive && (
          <button
            type="button"
            className="camera-empty-box"
            onClick={handleTriggerInput}
            aria-label="No image selected. Select an image."
          >
            <div className="empty-box-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <span className="empty-box-heading">No image selected</span>
            <span className="empty-box-text">
              Select an image or start the camera.
            </span>
          </button>
        )
      ) : (
        <div className="preview-container">
          <div className="image-preview-wrapper">
            <img
              src={previewUrl}
              alt={selectedFile ? `Preview of the selected image: ${selectedFile.name}` : 'Preview of the selected image'}
              className="image-preview"
            />
          </div>

          <div className="preview-file-bar">
            <span className="preview-file-name" title={selectedFile?.name}>
              {selectedFile?.name}
            </span>
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

      {/* Main Select Image Button (full width) */}
      <button
        type="button"
        className="btn-select-image"
        onClick={handleTriggerInput}
        disabled={isBusy}
        aria-label="Select image file or take a photo"
      >
        Select image
      </button>

      {/* 3-Button Control Row: Rotate, Replace, Clear */}
      <div className="camera-secondary-actions" role="group" aria-label="Image adjustment controls">
        <button
          type="button"
          className="btn-image-action"
          onClick={handleRotateImage}
          disabled={!hasImage || isBusy}
          aria-label="Rotate image 90 degrees clockwise"
        >
          Rotate
        </button>
        <button
          type="button"
          className="btn-image-action"
          onClick={handleTriggerInput}
          disabled={!hasImage || isBusy}
          aria-label="Replace current image"
        >
          Replace
        </button>
        <button
          type="button"
          className="btn-image-action"
          onClick={handleClearImage}
          disabled={!hasImage || isBusy}
          aria-label="Clear current image"
        >
          Clear
        </button>
      </div>

      {/* 2-Button Primary Actions Row: Describe, Read text */}
      <div className="camera-primary-actions" role="group" aria-label="Image AI analysis actions">
        <button
          type="button"
          className={`btn-primary-action ${canDescribe ? 'btn-primary-action--enabled' : ''}`}
          disabled={!canDescribe}
          aria-busy={isDescribing}
          title={statusText || undefined}
          onClick={handleDescribeClick}
        >
          {isDescribing ? 'Describing...' : 'Describe'}
        </button>

        <button
          type="button"
          className={`btn-primary-action ${canReadText ? 'btn-primary-action--enabled' : ''}`}
          disabled={!canReadText}
          aria-busy={isReadingText}
          title={statusText || undefined}
          onClick={handleReadTextClick}
        >
          {isReadingText ? 'Reading...' : 'Read text'}
        </button>
      </div>

      {/* Safety & guidance text */}
      <div className="camera-safety-notes">
        <p className="camera-hint-text">
          Select an image or start the camera to enable these actions.
        </p>
        <p className="camera-disclaimer-text">
          AI descriptions may be inaccurate. Verify important details with a trusted source.
        </p>
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

