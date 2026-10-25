let chatWorker = null;
let requestCounter = 0;
let isReady = false;
const pendingRequests = new Map();

function createRequestId() {
  requestCounter += 1;
  return `chat_${Date.now()}_${requestCounter}`;
}

function getWorker() {
  if (chatWorker) return chatWorker;
  if (typeof Worker !== 'function') {
    throw new Error('Web Workers are not supported in this browser.');
  }

  chatWorker = new Worker(new URL('./chat.worker.js', import.meta.url), { type: 'module' });

  chatWorker.onmessage = ({ data = {} }) => {
    const request = pendingRequests.get(data.id);
    if (!request) return;

    if (data.type === 'loading_progress' || data.type === 'generation_started') {
      request.onProgress?.(data);
      return;
    }

    if (data.type === 'model_ready') {
      isReady = true;
      request.onProgress?.({ phase: 'ready', device: data.device });
      return;
    }

    if (data.type === 'chat_complete') {
      pendingRequests.delete(data.id);
      request.resolve(data.reply);
      return;
    }

    if (data.type === 'error') {
      if (data.phase === 'loading') isReady = false;
      pendingRequests.delete(data.id);
      request.reject(new Error(data.message || 'The local chat model could not generate a reply.'));
    }
  };

  chatWorker.onerror = (event) => {
    const error = new Error(`Chat worker failed: ${event.message || 'unknown worker error'}`);
    for (const [id, request] of pendingRequests) {
      pendingRequests.delete(id);
      request.reject(error);
    }
    isReady = false;
    chatWorker?.terminate();
    chatWorker = null;
  };

  chatWorker.onmessageerror = () => {
    const error = new Error('The chat worker returned an unreadable response.');
    for (const [id, request] of pendingRequests) {
      pendingRequests.delete(id);
      request.reject(error);
    }
  };

  return chatWorker;
}

/** Returns whether the local Qwen model is loaded in its worker. */
export function isChatReady() {
  return isReady;
}

/**
 * Generates a reply from the local Qwen model using the supplied conversation.
 * Progress callbacks receive loading and generation state objects.
 *
 * @param {{ role: 'user'|'assistant'|'system', content: string }[]} messages
 * @param {(progress: object) => void} [onProgress]
 * @returns {Promise<string>}
 */
export function generateChatReply(messages, onProgress) {
  const conversation = Array.isArray(messages)
    ? messages.filter((message) => (
      ['user', 'assistant', 'system'].includes(message?.role) &&
      typeof message.content === 'string' &&
      message.content.trim()
    ))
    : [];

  if (!conversation.length || conversation.at(-1).role !== 'user') {
    return Promise.reject(new Error('Enter a message before sending.'));
  }

  let worker;
  try {
    worker = getWorker();
  } catch (error) {
    return Promise.reject(error);
  }

  const id = createRequestId();
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, action: 'generate', messages: conversation });
  });
}