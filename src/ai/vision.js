/**
 * Personal AI Companion — In-Browser Vision Module
 * Model: HuggingFaceTB/SmolVLM-500M-Instruct
 * 
 * Provides an isolated, reliable interface for on-device image description
 * running in a dedicated Web Worker via Transformers.js.
 */

// Worker singleton and lifecycle state
let visionWorker = null;
let isReady = false;
let activeDevice = null;
let loadPromise = null;
let loadProgressCallbacks = new Set();

// Map tracking active asynchronous requests by unique ID
const pendingRequests = new Map();
let requestIdCounter = 0;

function getNextId() {
  requestIdCounter += 1;
  return `req_${Date.now()}_${requestIdCounter}`;
}

/**
 * Lazily initialize or retrieve the vision Web Worker.
 */
function getWorker() {
  if (!visionWorker) {
    visionWorker = new Worker(new URL('./vision.worker.js', import.meta.url), {
      type: 'module',
    });

    visionWorker.onmessage = (event) => {
      const { id, type, percent, answer, device, error } = event.data || {};
      const req = pendingRequests.get(id);

      if (type === 'progress') {
        // Broadcast progress to active loader callbacks
        if (typeof percent === 'number') {
          for (const callback of loadProgressCallbacks) {
            try {
              callback(percent);
            } catch (err) {
              console.error('Error in onProgress callback:', err);
            }
          }
        }
        return;
      }

      if (type === 'load_complete') {
        isReady = true;
        activeDevice = device || 'unknown';
        for (const callback of loadProgressCallbacks) {
          try {
            callback(100);
          } catch (err) {
            console.error('Error in onProgress callback:', err);
          }
        }
        if (req) {
          pendingRequests.delete(id);
          req.resolve({ ready: true, device: activeDevice });
        }
        return;
      }

      if (type === 'describe_complete') {
        if (req) {
          pendingRequests.delete(id);
          req.resolve(answer);
        }
        return;
      }

      if (type === 'error') {
        const errObj = new Error(error || 'Unknown vision worker error');
        if (req) {
          pendingRequests.delete(id);
          req.reject(errObj);
        }
      }
    };

    visionWorker.onerror = (errEvent) => {
      console.error('Vision Web Worker error event:', errEvent);
      const workerError = new Error(
        `Vision Web Worker encountered an error: ${errEvent.message || 'Worker crash or script error'}`
      );

      // Cleanly reject all pending requests to avoid permanently hanging promises
      for (const [id, req] of pendingRequests.entries()) {
        pendingRequests.delete(id);
        req.reject(workerError);
      }

      // Reset loading state so future calls can recreate or retry cleanly
      isReady = false;
      loadPromise = null;
      loadProgressCallbacks.clear();
      if (visionWorker) {
        visionWorker.terminate();
        visionWorker = null;
      }
    };

    visionWorker.onmessageerror = (errEvent) => {
      console.error('Vision Web Worker serialization error:', errEvent);
      const serError = new Error('Failed to deserialize message from Vision Worker.');
      for (const [id, req] of pendingRequests.entries()) {
        pendingRequests.delete(id);
        req.reject(serError);
      }
    };
  }

  return visionWorker;
}

/**
 * Checks whether the vision model is loaded and ready for inference.
 * @returns {boolean} True if the model is loaded and ready.
 */
export function isVisionReady() {
  return isReady;
}

/**
 * Returns the currently active execution device (e.g., 'webgpu' or 'wasm').
 * @returns {string|null}
 */
export function getVisionDevice() {
  return activeDevice;
}

/**
 * Loads the vision model in the Web Worker.
 * If already loaded, resolves immediately and calls onProgress(100).
 * If loading is already in progress, attaches onProgress and awaits the existing promise.
 * 
 * @param {Function} [onProgress] Callback receiving an integer percentage from 0 to 100.
 * @returns {Promise<{ ready: boolean, device: string }>} Resolves with readiness and device info.
 */
export function loadVision(onProgress) {
  if (typeof onProgress === 'function') {
    loadProgressCallbacks.add(onProgress);
  }

  // If already loaded and ready, immediately report 100% and resolve
  if (isReady) {
    if (typeof onProgress === 'function') {
      try {
        onProgress(100);
      } catch (err) {
        console.error('Error in onProgress callback:', err);
      }
    }
    return Promise.resolve({ ready: true, device: activeDevice });
  }

  // If already in the process of loading, reuse the existing Promise
  if (loadPromise) {
    return loadPromise;
  }

  const worker = getWorker();
  const id = getNextId();

  loadPromise = new Promise((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: (result) => {
        loadPromise = null;
        loadProgressCallbacks.clear();
        resolve(result);
      },
      reject: (err) => {
        loadPromise = null;
        isReady = false;
        loadProgressCallbacks.clear();
        reject(err);
      },
    });

    worker.postMessage({ id, action: 'load' });
  });

  return loadPromise;
}

/**
 * Resizes an image so its longest side is at most maxSide (640px)
 * using createImageBitmap and an offscreen or standard canvas.
 * 
 * @param {Blob|File} file
 * @param {number} [maxSide=640]
 * @returns {Promise<Blob>}
 */
async function resizeImage(file, maxSide = 640) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch (err) {
    throw new Error(
      `Unable to decode image file. The image may be corrupt or an unsupported format: ${err.message || err}`
    );
  }

  const origWidth = bmp.width;
  const origHeight = bmp.height;

  if (!origWidth || !origHeight) {
    bmp.close();
    throw new Error('Image has zero or invalid dimensions and cannot be processed.');
  }

  const longestSide = Math.max(origWidth, origHeight);
  const scale = Math.min(1, maxSide / longestSide);
  const targetWidth = Math.max(1, Math.round(origWidth * scale));
  const targetHeight = Math.max(1, Math.round(origHeight * scale));

  let blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, targetWidth, targetHeight);
    bmp.close();
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, targetWidth, targetHeight);
    bmp.close();
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob failed during image resize.'));
        },
        'image/jpeg',
        0.9
      );
    });
  } else {
    bmp.close();
    throw new Error('Canvas API is not available in this environment.');
  }

  return blob;
}

/**
 * Validates, prepares, and runs vision inference on an image.
 * 
 * @param {File|Blob} imageFile The image to describe.
 * @param {string} [question] Optional custom prompt (defaults to "Describe this image in detail.").
 * @returns {Promise<string>} Model-generated answer.
 */
export async function describeImage(imageFile, question = 'Describe this image in detail.') {
  // Input validation
  if (!imageFile) {
    throw new Error('No image was provided. Please select an image first.');
  }

  if (!(imageFile instanceof Blob)) {
    throw new Error('Invalid image input: expected a File or Blob object.');
  }

  if (imageFile.type && !imageFile.type.startsWith('image/')) {
    throw new Error(
      `Invalid file format "${imageFile.type}". Please choose a valid image file (JPEG, PNG, WebP, etc.).`
    );
  }

  // Maximum file size guard (25MB)
  const MAX_SIZE_BYTES = 25 * 1024 * 1024;
  if (imageFile.size > MAX_SIZE_BYTES) {
    throw new Error(
      `Image file size (${(imageFile.size / (1024 * 1024)).toFixed(1)}MB) exceeds the 25MB limit. Please select a smaller photo.`
    );
  }

  // Ensure model is loaded before sending inference
  if (!isReady) {
    await loadVision();
  }

  // Resize image to max 640px longest side
  const resizedBlob = await resizeImage(imageFile, 640);

  const worker = getWorker();
  const id = getNextId();

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({
      id,
      action: 'describe',
      imageBlob: resizedBlob,
      question: question || 'Describe this image in detail.',
    });
  });
}
