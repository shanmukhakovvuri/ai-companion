/**
 * Personal AI Companion — In-Browser Chat Module
 * Model: onnx-community/Qwen2.5-0.5B-Instruct (q4 quantized)
 * 
 * Provides an isolated, reliable interface for on-device conversational AI
 * running in a dedicated Web Worker via Transformers.js.
 */

// Worker singleton and lifecycle state
let chatWorker = null;
let isReady = false;
let activeDevice = null;
let loadPromise = null;
const loadProgressCallbacks = new Set();

// Map tracking active asynchronous requests by unique ID
const pendingRequests = new Map();
let requestIdCounter = 0;

function getNextId() {
  requestIdCounter += 1;
  return `chat_req_${Date.now()}_${requestIdCounter}`;
}

/**
 * Lazily initialize or retrieve the chat Web Worker.
 */
function getWorker() {
  if (!chatWorker) {
    chatWorker = new Worker(new URL('./chat.worker.js', import.meta.url), {
      type: 'module',
    });

    chatWorker.onmessage = (event) => {
      const { id, type, percent, text, device, error } = event.data || {};
      const req = pendingRequests.get(id);

      if (type === 'progress') {
        if (typeof percent === 'number') {
          for (const callback of loadProgressCallbacks) {
            try {
              callback(percent);
            } catch (err) {
              console.error('Error in chat onProgress callback:', err);
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
            console.error('Error in chat onProgress callback:', err);
          }
        }
        if (req) {
          pendingRequests.delete(id);
          req.resolve({ ready: true, device: activeDevice });
        }
        return;
      }

      if (type === 'generate_complete') {
        if (req) {
          pendingRequests.delete(id);
          req.resolve(text);
        }
        return;
      }

      if (type === 'error') {
        const errObj = new Error(error || 'Unknown chat worker error');
        if (req) {
          pendingRequests.delete(id);
          req.reject(errObj);
        }
      }
    };

    chatWorker.onerror = (errEvent) => {
      console.error('Chat Web Worker error event:', errEvent);
      const workerError = new Error(
        `Chat Web Worker encountered an error: ${errEvent.message || 'Worker crash or script error'}`
      );

      for (const [id, req] of pendingRequests.entries()) {
        pendingRequests.delete(id);
        req.reject(workerError);
      }

      isReady = false;
      loadPromise = null;
      loadProgressCallbacks.clear();
      if (chatWorker) {
        chatWorker.terminate();
        chatWorker = null;
      }
    };

    chatWorker.onmessageerror = (errEvent) => {
      console.error('Chat Web Worker serialization error:', errEvent);
      const serError = new Error('Failed to deserialize message from Chat Worker.');
      for (const [id, req] of pendingRequests.entries()) {
        pendingRequests.delete(id);
        req.reject(serError);
      }
    };
  }

  return chatWorker;
}

/**
 * Checks whether the chat model is loaded and ready for inference.
 * @returns {boolean}
 */
export function isChatReady() {
  return isReady;
}

/**
 * Returns the currently active execution device (e.g., 'webgpu' or 'wasm').
 * @returns {string|null}
 */
export function getChatDevice() {
  return activeDevice;
}

/**
 * Loads the chat model in the Web Worker.
 * If already loaded, resolves immediately and calls onProgress(100).
 * If loading is already in progress, attaches onProgress and awaits the existing promise.
 * 
 * @param {Function} [onProgress] Callback receiving an integer percentage from 0 to 100.
 * @returns {Promise<{ ready: boolean, device: string }>}
 */
export function loadChat(onProgress) {
  if (typeof onProgress === 'function') {
    loadProgressCallbacks.add(onProgress);
  }

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
 * Format conversation history and generate an in-browser AI response.
 * 
 * @param {string} userPrompt The latest user message.
 * @param {Array<{ sender: string, text: string }>} [conversationHistory=[]] Previous chat history.
 * @param {object} [options={}] Generation options (max_new_tokens, temperature, etc.).
 * @returns {Promise<string>} Generated text reply.
 */
export async function generateChat(userPrompt, conversationHistory = [], options = {}) {
  const prompt = (userPrompt || '').trim();
  if (!prompt) {
    throw new Error('Please enter a message before sending.');
  }

  // Ensure model is loaded before sending inference
  if (!isReady) {
    await loadChat();
  }


  // Build standard chat template messages
  const systemMessage = {
    role: 'system',
    content:
      'You are a helpful Personal AI Companion. ' +
      'Answer the user’s exact question directly using simple, clear language. ' +
      'Stay focused on the topic and do not add unrelated examples, stories, or extra claims. ' +
      'For comparison questions, explain the main differences in a short, organized format. ' +
      'For calculations, give the correct result and a brief explanation when useful. ' +
      'If you do not know something, say so instead of guessing. ' +
      'Keep answers concise and stop when the question has been answered.',
  };


  // Convert previous history into user/assistant turns (keep last 8 turns for responsive inference)
  const historyTurns = (conversationHistory || [])
    .filter((m) => m && m.text && (m.sender === 'user' || m.sender === 'assistant'))
    .slice(-8)
    .map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

  const messages = [
    systemMessage,
    ...historyTurns,
    { role: 'user', content: prompt },
  ];

  const worker = getWorker();
  const id = getNextId();

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({
      id,
      action: 'generate',
      messages,
      options,
    });
  });
}
