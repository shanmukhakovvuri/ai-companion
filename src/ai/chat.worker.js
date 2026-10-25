import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
let generator = null;
let loadingPromise = null;

function send(id, type, values = {}) {
  self.postMessage({ id, type, ...values });
}

function createProgressCallback(id) {
  const fileProgress = new Map();

  return (progress) => {
    if (progress?.file && typeof progress.loaded === 'number' && typeof progress.total === 'number') {
      fileProgress.set(progress.file, { loaded: progress.loaded, total: progress.total });
    }

    const values = [...fileProgress.values()];
    const totalLoaded = values.reduce((sum, file) => sum + file.loaded, 0);
    const totalSize = values.reduce((sum, file) => sum + file.total, 0);
    const percent = totalSize > 0
      ? Math.min(99, Math.round((totalLoaded / totalSize) * 100))
      : typeof progress?.progress === 'number'
        ? Math.min(99, Math.round(progress.progress * 100))
        : null;

    send(id, 'loading_progress', {
      phase: 'loading',
      percent,
      file: progress?.file || null,
      status: progress?.status || 'loading',
    });
  };
}

async function loadGenerator(id) {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const progress_callback = createProgressCallback(id);
    const hasWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu);

    if (hasWebGPU) {
      try {
        generator = await pipeline('text-generation', MODEL_ID, {
          device: 'webgpu',
          dtype: 'q4f16',
          progress_callback,
        });
        return generator;
      } catch (webGpuError) {
        send(id, 'loading_progress', {
          phase: 'fallback',
          percent: null,
          message: 'WebGPU could not initialize. Switching to the browser CPU runtime.',
        });
        console.warn('Qwen WebGPU load failed; falling back to WASM.', webGpuError);
      }
    }

    try {
      generator = await pipeline('text-generation', MODEL_ID, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback,
      });
      return generator;
    } catch (wasmError) {
      throw new Error(`Qwen could not load with WebGPU or WASM: ${wasmError.message || wasmError}`);
    }
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

self.onmessage = async ({ data = {} }) => {
  const { id, action, messages } = data;
  if (!id || action !== 'generate') return;

  try {
    const model = await loadGenerator(id);
    send(id, 'model_ready', { device: model.model?.device || 'browser' });
    send(id, 'generation_started', { phase: 'generating' });

    const output = await model(messages, {
      max_new_tokens: 64,
      do_sample: true,
      temperature: 0.7,
      top_k: 20,
      top_p: 0.8,
      repetition_penalty: 1.1,
    });

    const generated = output?.[0]?.generated_text;
    const lastMessage = Array.isArray(generated) ? generated.at(-1) : null;
    const reply = typeof lastMessage?.content === 'string'
      ? lastMessage.content.trim()
      : typeof generated === 'string'
        ? generated.trim()
        : '';

    if (!reply) throw new Error('The local model returned an empty reply. Try a shorter message.');
    send(id, 'chat_complete', { reply });
  } catch (error) {
    send(id, 'error', {
      phase: generator ? 'generation' : 'loading',
      message: error.message || 'The local chat model could not generate a reply.',
    });
  }
};