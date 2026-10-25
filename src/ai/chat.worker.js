/**
 * Web Worker for in-browser conversational text generation using Transformers.js
 * Model: onnx-community/Qwen2.5-0.5B-Instruct (q4 quantized)
 * 
 * Runs heavy model downloading, tokenization, and neural network inference
 * off the main UI thread to ensure zero UI freezing or dropped frames.
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure environment for browser Web Worker
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

let generator = null;
let loadedDevice = null;
let loadingPromise = null;

// Track file download progress across multiple model files
const fileProgress = {};

function handleProgress(p, id) {
  if (p.status === 'progress' && p.file) {
    fileProgress[p.file] = {
      loaded: p.loaded || 0,
      total: p.total || 0,
    };

    let totalLoaded = 0;
    let totalSize = 0;
    for (const f of Object.values(fileProgress)) {
      totalLoaded += f.loaded;
      totalSize += f.total;
    }

    if (totalSize > 0) {
      const percent = Math.min(99, Math.round((totalLoaded / totalSize) * 100));
      self.postMessage({
        id,
        type: 'progress',
        percent,
        loaded: totalLoaded,
        total: totalSize,
        file: p.file,
      });
    }
  }
}

/**
 * Initialize and load the Qwen2.5-0.5B-Instruct pipeline.
 * Tries WebGPU first for hardware acceleration, falling back to WASM / CPU.
 */
async function loadModel(id) {
  if (generator) {
    return { device: loadedDevice };
  }

  const progressCallback = (p) => handleProgress(p, id);

  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu);

  // 1. Try WebGPU if available
  if (hasWebGPU) {
    try {
      generator = await pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
        device: 'webgpu',
        progress_callback: progressCallback,
      });
      loadedDevice = 'webgpu';
      return { device: loadedDevice };
    } catch (err) {
      console.warn('WebGPU text-generation initialization failed. Falling back to WASM:', err);
    }
  }

  // 2. Fallback: Try WASM
  try {
    generator = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      device: 'wasm',
      progress_callback: progressCallback,
    });
    loadedDevice = 'wasm';
    return { device: loadedDevice };
  } catch (wasmErr) {
    // 3. Fallback: Try default / CPU execution provider
    try {
      generator = await pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
        progress_callback: progressCallback,
      });
      loadedDevice = 'wasm';
      return { device: loadedDevice };
    } catch (cpuErr) {
      throw new Error(
        `Failed to initialize local chat model (${MODEL_ID}).\n` +
        `WebGPU status: ${hasWebGPU ? 'WebGPU execution failed' : 'WebGPU not supported in this browser'}\n` +
        `WASM error: ${wasmErr.message || wasmErr}\n` +
        `CPU error: ${cpuErr.message || cpuErr}`
      );
    }
  }
}

/**
 * Execute text generation using conversation turns and the model's chat template.
 */
async function runGeneration(messages, options = {}) {
  if (!generator) {
    throw new Error('Chat model is not loaded yet. Call loadChat() before requesting responses.');
  }

  // Apply chat template with system prompt and history
  let promptText;
  try {
    if (generator.tokenizer && typeof generator.tokenizer.apply_chat_template === 'function') {
      promptText = generator.tokenizer.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: true,
      });
    } else {
      // Fallback prompt formatting
      promptText = messages
        .map((m) => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content}`)
        .join('\n\n') + '\n\nAssistant:';
    }
  } catch (err) {
    console.warn('Chat template application failed, falling back to manual format:', err);
    promptText = messages
      .map((m) => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content}`)
      .join('\n\n') + '\n\nAssistant:';
  }

  const maxNewTokens = options.max_new_tokens || 140;
  const temperature = options.temperature ?? 0.7;
  const repetitionPenalty = options.repetition_penalty ?? 1.15;

  let output;
  try {
    output = await generator(promptText, {
      max_new_tokens: maxNewTokens,
      return_full_text: false,
      temperature,
      repetition_penalty: repetitionPenalty,
    });
  } catch (err) {
    const errMsg = err.message || String(err);
    if (errMsg.includes('out of memory') || errMsg.includes('OOM') || errMsg.includes('allocation')) {
      throw new Error(`Out-of-memory error during chat generation: ${errMsg}. Try closing other applications or browser tabs.`);
    }
    throw new Error(`Inference failure during text generation: ${errMsg}`);
  }

  let answer = '';
  if (Array.isArray(output) && output[0]?.generated_text) {
    answer = output[0].generated_text;
  } else if (typeof output === 'string') {
    answer = output;
  }

  answer = answer.trim();

  // If the answer is cut off abruptly without punctuation, trim to the last sentence
  if (answer.length > 40 && !/[.!?]$/.test(answer)) {
    const lastPunct = Math.max(answer.lastIndexOf('.'), answer.lastIndexOf('!'), answer.lastIndexOf('?'));
    if (lastPunct > 20) {
      answer = answer.slice(0, lastPunct + 1).trim();
    }
  }

  return answer;
}

// Worker message dispatcher
self.onmessage = async (e) => {
  const { id, action, messages, options } = e.data || {};

  if (!id) return;

  if (action === 'load') {
    try {
      if (!loadingPromise) {
        loadingPromise = loadModel(id);
      }
      const result = await loadingPromise;
      self.postMessage({
        id,
        type: 'load_complete',
        device: result.device,
      });
    } catch (err) {
      loadingPromise = null;
      self.postMessage({
        id,
        type: 'error',
        error: err.message || String(err),
      });
    }
  } else if (action === 'generate') {
    try {
      const text = await runGeneration(messages, options);
      self.postMessage({
        id,
        type: 'generate_complete',
        text,
      });
    } catch (err) {
      self.postMessage({
        id,
        type: 'error',
        error: err.message || String(err),
      });
    }
  } else if (action === 'ping') {
    self.postMessage({
      id,
      type: 'pong',
      ready: Boolean(generator),
      device: loadedDevice,
    });
  } else {
    self.postMessage({
      id,
      type: 'error',
      error: `Unknown action: "${action}"`,
    });
  }
};
