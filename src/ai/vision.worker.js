/**
 * Web Worker for in-browser AI vision inference using Transformers.js
 * Model: HuggingFaceTB/SmolVLM-500M-Instruct
 * 
 * Runs heavy model downloading, tokenization, and neural network inference
 * off the main UI thread to ensure zero UI freezing or dropped frames.
 */

import {
  AutoProcessor,
  AutoModelForVision2Seq,
  load_image,
  env,
} from '@huggingface/transformers';

// Configure environment for browser Web Worker
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'HuggingFaceTB/SmolVLM-500M-Instruct';

let processor = null;
let model = null;
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
 * Initialize and load the SmolVLM model and processor.
 * First tries WebGPU with mixed quantization ({ embed_tokens: "fp16", vision_encoder: "q4", decoder_model_merged: "q4" }).
 * If WebGPU fails or is unavailable, falls back to WASM ({ embed_tokens: "q8", vision_encoder: "q8", decoder_model_merged: "q8" }).
 */
async function loadModel(id) {
  if (processor && model) {
    return { device: loadedDevice };
  }

  const progressCallback = (p) => handleProgress(p, id);

  // 1. Load Processor
  try {
    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: progressCallback,
    });
  } catch (err) {
    throw new Error(`Failed to load vision processor (${MODEL_ID}): ${err.message || err}`);
  }

  // 2. Load Model: Try WebGPU first, then WASM
  const webgpuDtype = {
    embed_tokens: 'fp16',
    vision_encoder: 'q4',
    decoder_model_merged: 'q4',
  };

  const wasmDtype = {
    embed_tokens: 'q8',
    vision_encoder: 'q8',
    decoder_model_merged: 'q8',
  };

  let webgpuError = null;

  // Check if WebGPU is available in this browser/worker
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;

  if (hasWebGPU) {
    try {
      model = await AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
        dtype: webgpuDtype,
        device: 'webgpu',
        progress_callback: progressCallback,
      });
      loadedDevice = 'webgpu';
    } catch (err) {
      webgpuError = err;
      console.warn('WebGPU initialization failed for SmolVLM. Falling back to WASM:', err);
    }
  } else {
    webgpuError = new Error('WebGPU is not supported by this browser or worker context.');
  }

  // If WebGPU was unavailable or failed, load with WASM
  if (!loadedDevice) {
    try {
      model = await AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
        dtype: wasmDtype,
        device: 'wasm',
        progress_callback: progressCallback,
      });
      loadedDevice = 'wasm';
    } catch (wasmErr) {
      throw new Error(
        `Failed to initialize vision model on both WebGPU and WASM.\n` +
        `WebGPU error: ${webgpuError ? (webgpuError.message || webgpuError) : 'Unsupported'}\n` +
        `WASM error: ${wasmErr.message || wasmErr}`
      );
    }
  }

  return { device: loadedDevice };
}

/**
 * Execute vision inference on an input image blob and question.
 */
async function runInference(imageBlob, question) {
  if (!processor || !model) {
    throw new Error('Vision model is not loaded yet. Call loadVision() before requesting image descriptions.');
  }

  const promptText = question && question.trim().length > 0
    ? question.trim()
    : 'Describe this image in detail.';

  // Read image via blob URL and load_image
  let blobUrl = null;
  let rawImage = null;
  try {
    blobUrl = URL.createObjectURL(imageBlob);
    rawImage = await load_image(blobUrl);
  } catch (err) {
    throw new Error(`Failed to decode image input: ${err.message || err}`);
  } finally {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // Build chat-template message
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image' },
        { type: 'text', text: promptText },
      ],
    },
  ];

  let formattedPrompt;
  try {
    formattedPrompt = processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    });
  } catch (err) {
    throw new Error(`Failed to apply chat template: ${err.message || err}`);
  }

  let inputs;
  try {
    // Process text and image with do_image_splitting: false as verified in feasibility tests
    inputs = await processor(formattedPrompt, [rawImage], {
      do_image_splitting: false,
    });
  } catch (err) {
    throw new Error(`Failed to preprocess image and prompt inputs: ${err.message || err}`);
  }

  // Generate at most 120 new tokens with anti-repetition guards
  let generatedTokens;
  try {
    generatedTokens = await model.generate({
      ...inputs,
      max_new_tokens: 120,
      repetition_penalty: 1.2,
      no_repeat_ngram_size: 3,
    });
  } catch (err) {
    const errMsg = err.message || String(err);
    if (errMsg.includes('out of memory') || errMsg.includes('OOM') || errMsg.includes('allocation')) {
      throw new Error(`Out-of-memory error during vision inference: ${errMsg}. Try closing other applications or browser tabs.`);
    }
    throw new Error(`Inference failure during token generation: ${errMsg}`);
  }

  // Decode only newly generated tokens, excluding the input prompt
  try {
    const promptLength = inputs.input_ids.dims.at(-1);
    const newTokens = generatedTokens.slice(null, [promptLength, null]);
    const decodedArray = processor.batch_decode(newTokens, {
      skip_special_tokens: true,
    });

    let answer = decodedArray && decodedArray[0] ? decodedArray[0].trim() : '';

    // Safety fallback: if slice returned empty, decode full sequence and strip prompt
    if (!answer) {
      const fullDecoded = processor.batch_decode(generatedTokens, {
        skip_special_tokens: true,
      });
      if (fullDecoded && fullDecoded[0]) {
        answer = fullDecoded[0].replace(formattedPrompt, '').trim();
      }
    }

    return answer;
  } catch (err) {
    throw new Error(`Failed to decode generated response tokens: ${err.message || err}`);
  }
}

// Worker message dispatcher
self.onmessage = async (e) => {
  const { id, action, imageBlob, question } = e.data || {};

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
  } else if (action === 'describe') {
    try {
      const answer = await runInference(imageBlob, question);
      self.postMessage({
        id,
        type: 'describe_complete',
        answer,
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
      ready: !!(processor && model),
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
