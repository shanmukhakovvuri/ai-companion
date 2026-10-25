
import { createWorker } from 'tesseract.js';

let workerPromise = null;

/**
 * Extracts text from an image using Tesseract.js in the browser.
 * The first use downloads the English OCR language data.
 */
export async function readTextFromImage(imageFile, onProgress) {
  if (!imageFile) {
    throw new Error('Please select an image first.');
  }

  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: (message) => {
        if (message.status === 'recognizing text' && typeof onProgress === 'function') {
          onProgress(Math.round((message.progress || 0) * 100));
        }
      },
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  const worker = await workerPromise;

  try {
    const result = await worker.recognize(imageFile);
    const text = result.data.text.trim();

    if (!text) {
      return 'No readable text was found. Try a clearer, well-lit image.';
    }

    return text;
  } catch (error) {
    throw new Error(`Could not read text from the image: ${error.message}`);
  }
}
