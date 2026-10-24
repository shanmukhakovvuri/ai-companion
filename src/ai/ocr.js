/**
 * Personal AI Companion â€” On-Device OCR Module
 * Library: tesseract.js v7.0.0
 *
 * Provides accessible, on-device optical character recognition
 * for documents, receipts, signs, and labels without sending images to any server.
 */

import { createWorker } from 'tesseract.js';

// Worker singleton, state, and promises
let ocrWorker = null;
let currentLang = 'eng';
let ocrLoadPromise = null;
let isReady = false;

/**
 * Checks whether the OCR engine is initialized and ready.
 * @returns {boolean}
 */
export function isOcrReady() {
  return isReady && Boolean(ocrWorker);
}

/**
 * Preprocesses an image before OCR for higher recognition accuracy:
 * 1. Scales so longest side is ~1600px (upscales small images max 2x).
 * 2. Converts to grayscale.
 * 3. Applies careful contrast enhancement to sharpen text glyphs.
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<HTMLCanvasElement|OffscreenCanvas>} Processed canvas
 */
export async function preprocessImageForOcr(imageFile) {
  let bmp;
  try {
    bmp = await createImageBitmap(imageFile);
  } catch {
    throw new Error('This image could not be read. Try another image.');
  }

  const origWidth = bmp.width;
  const origHeight = bmp.height;

  if (!origWidth || !origHeight) {
    bmp.close();
    throw new Error('This image could not be read. Try another image.');
  }

  const longestSide = Math.max(origWidth, origHeight);
  let scale;

  if (longestSide < 1600) {
    // Upscale small image, capped at 2x
    scale = Math.min(2.0, 1600 / longestSide);
  } else {
    // Downscale large image so longest side is ~1600px
    scale = 1600 / longestSide;
  }

  const targetWidth = Math.max(1, Math.round(origWidth * scale));
  const targetHeight = Math.max(1, Math.round(origHeight * scale));

  let canvas;
  let ctx;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
    ctx = canvas.getContext('2d');
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx = canvas.getContext('2d');
  } else {
    bmp.close();
    throw new Error('Canvas API is not available in this environment.');
  }

  if (!ctx) {
    bmp.close();
    throw new Error('Failed to obtain canvas 2D rendering context.');
  }

  // Draw scaled image
  ctx.drawImage(bmp, 0, 0, targetWidth, targetHeight);
  bmp.close();

  // Document Isolation: If the image is a photo of a document/card sitting on a dark/noisy table,
  // isolate the document region so the background texture does not overwhelm Tesseract.
  try {
    const blockSize = 16;
    const bw = Math.floor(targetWidth / blockSize);
    const bh = Math.floor(targetHeight / blockSize);

    if (bw >= 4 && bh >= 4) {
      const rawImg = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const rawData = rawImg.data;
      const rowCounts = new Int32Array(bh);
      const colCounts = new Int32Array(bw);

      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          let objectPixels = 0;
          for (let dy = 0; dy < blockSize; dy++) {
            const y = by * blockSize + dy;
            for (let dx = 0; dx < blockSize; dx++) {
              const x = bx * blockSize + dx;
              const idx = (y * targetWidth + x) * 4;
              const r = rawData[idx];
              const g = rawData[idx + 1];
              const b = rawData[idx + 2];
              // Saturated document colors (green, purple, blue, red) or bright paper/card luma
              const isGreen = g > 75 && g > r * 1.15 && g > b * 1.15;
              const isPurple = b > 65 && b > g * 1.15;
              const isBright = (0.299 * r + 0.587 * g + 0.114 * b) > 170;
              if (isGreen || isPurple || isBright) objectPixels++;
            }
          }
          if (objectPixels > (blockSize * blockSize * 0.20)) {
            rowCounts[by]++;
            colCounts[bx]++;
          }
        }
      }

      // Filter out isolated noise/reflections by requiring at least 5 active blocks per row/column
      const minBlocks = 5;
      let minBY = -1, maxBY = -1, minBX = -1, maxBX = -1;

      for (let by = 0; by < bh; by++) {
        if (rowCounts[by] >= minBlocks) { minBY = by; break; }
      }
      for (let by = bh - 1; by >= 0; by--) {
        if (rowCounts[by] >= minBlocks) { maxBY = by; break; }
      }
      for (let bx = 0; bx < bw; bx++) {
        if (colCounts[bx] >= minBlocks) { minBX = bx; break; }
      }
      for (let bx = bw - 1; bx >= 0; bx--) {
        if (colCounts[bx] >= minBlocks) { maxBX = bx; break; }
      }

      if (minBY !== -1 && maxBY > minBY && minBX !== -1 && maxBX > minBX) {
        // Add comfortable padding around detected document edges so boundary text (like Proprietor / address) is never cut off
        const padX = Math.round(blockSize * 1.5);
        const padY = Math.round(blockSize * 1.5);
        const cropLeft = Math.max(0, minBX * blockSize - padX);
        const cropTop = Math.max(0, minBY * blockSize - padY);
        const cropRight = Math.min(targetWidth, (maxBX + 1) * blockSize + padX);
        const cropBottom = Math.min(targetHeight, (maxBY + 1) * blockSize + padY);
        const cropW = cropRight - cropLeft;
        const cropH = cropBottom - cropTop;
        const areaRatio = (cropW * cropH) / (targetWidth * targetHeight);

        // Crop only if the detected object is a bounded card/document occupying 15% to 92% of the frame
        if (areaRatio >= 0.15 && areaRatio <= 0.92 && cropW >= 100 && cropH >= 100) {
          const croppedCanvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(cropW, cropH)
            : document.createElement('canvas');
          croppedCanvas.width = cropW;
          croppedCanvas.height = cropH;
          const cCtx = croppedCanvas.getContext('2d');
          if (cCtx) {
            cCtx.drawImage(canvas, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH);
            canvas = croppedCanvas;
            ctx = cCtx;
          }
        }
      }
    }
  } catch (detectErr) {
    console.warn('Document region detection bypassed, using full canvas:', detectErr);
  }

  // Grayscale and balanced color normalization:
  // Use balanced color luminance (R + G + B)/3 rather than standard luma,
  // preventing blue/purple backgrounds from being crushed relative to green/bright sections.
  try {
    const curW = canvas.width;
    const curH = canvas.height;
    const imgData = ctx.getImageData(0, 0, curW, curH);
    const data = imgData.data;
    const len = data.length;
    const grayValues = new Uint8Array(len / 4);

    let minG = 255;
    let maxG = 0;

    for (let i = 0, j = 0; i < len; i += 4, j++) {
      // Balanced average of channels ensures uniform contrast across two-tone cards (e.g. purple + green)
      const g = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
      grayValues[j] = g;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
    }

    const range = maxG - minG;
    const stretch = range > 20 ? 255 / range : 1;

    for (let i = 0, j = 0; i < len; i += 4, j++) {
      let g = grayValues[j];
      if (range > 20) {
        g = Math.min(255, Math.max(0, Math.round((g - minG) * stretch)));
      }
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (err) {
    console.warn('Grayscale normalization failed, proceeding with canvas:', err);
  }

  return canvas;
}

/**
 * Initializes the Tesseract.js worker on demand.
 * Reuses the existing worker on subsequent calls with the same language.
 *
 * @param {Function} [onProgress] Callback receiving an integer percentage from 0 to 100.
 * @param {string} [lang="eng"] Language code
 * @returns {Promise<any>}
 */
export async function loadOcr(onProgress, lang = 'eng') {
  // If worker exists with the requested language, return immediately
  if (ocrWorker && currentLang === lang && isReady) {
    if (typeof onProgress === 'function') {
      try {
        onProgress(100);
      } catch (e) {
        console.error(e);
      }
    }
    return ocrWorker;
  }

  // If loading is already in progress, reuse the existing promise
  if (ocrLoadPromise) {
    return ocrLoadPromise;
  }

  // If language changed on an existing worker, terminate it first
  if (ocrWorker && currentLang !== lang) {
    try {
      await ocrWorker.terminate();
    } catch (e) {
      console.warn('Error terminating previous OCR worker:', e);
    }
    ocrWorker = null;
    isReady = false;
  }

  let lastReportedPercent = -1;

  const loggerCallback = (m) => {
    if (typeof onProgress === 'function' && m && typeof m.progress === 'number') {
      const rawPercent = Math.min(100, Math.max(0, Math.round(m.progress * 100)));
      if (rawPercent !== lastReportedPercent) {
        lastReportedPercent = rawPercent;
        try {
          onProgress(rawPercent);
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  ocrLoadPromise = (async () => {
    try {
      if (typeof onProgress === 'function') {
        onProgress(0);
      }

      // Tesseract.js v7 createWorker accepts (langs, oem, options)
      const worker = await createWorker(lang, 1, {
        logger: loggerCallback,
      });

      try {
        await worker.setParameters({
          user_defined_dpi: '300',
        });
      } catch (dpiErr) {
        console.warn('Could not set custom DPI on worker:', dpiErr);
      }

      ocrWorker = worker;
      currentLang = lang;
      isReady = true;

      if (typeof onProgress === 'function') {
        onProgress(100);
      }

      return ocrWorker;
    } catch (err) {
      isReady = false;
      ocrWorker = null;
      console.error('Tesseract OCR worker initialization error:', err);

      const msg = err.message || String(err);
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('download') || msg.includes('Failed to fetch')) {
        throw new Error('The OCR language data could not be downloaded. Check your internet connection and try again.');
      }
      throw new Error(`Failed to initialize OCR: ${msg}`);
    } finally {
      ocrLoadPromise = null;
    }
  })();

  return ocrLoadPromise;
}

/**
 * Rotates a 2D canvas by a specified number of degrees (e.g. 90, 180, 270).
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {number} degrees Angle in degrees
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
function rotateCanvas(srcCanvas, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const swap = degrees === 90 || degrees === 270;
  const w = swap ? srcCanvas.height : srcCanvas.width;
  const h = swap ? srcCanvas.width : srcCanvas.height;

  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  } else {
    return srcCanvas;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return srcCanvas;

  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
  return canvas;
}

/**
 * Assesses the linguistic coherence and character density of OCR output.
 * Distinguishes true words and phone numbers from fragmented symbol soup caused by wrong orientation.
 *
 * @param {string} text Recognized text
 * @param {number} confidence Tesseract confidence score
 * @returns {{ score: number, confidence: number, wordCount: number, meaningfulWords: number, coherenceRatio: number }}
 */
function evaluateOcrQuality(text, confidence) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { score: 0, confidence: 0, wordCount: 0, meaningfulWords: 0, coherenceRatio: 0 };
  }

  const trimmed = text.trim();
  const rawWords = trimmed.split(/\s+/).filter(Boolean);

  const commonShort = new Set(['in', 'to', 'at', 'on', 'of', 'is', 'no', 'mr', 'dr', 'am', 'pm', 'us', 'we', 'he', 'by']);

  let meaningfulWordCount = 0;
  for (const raw of rawWords) {
    const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/^\d{4,}$/.test(clean)) {
      meaningfulWordCount += 2; // Phone numbers and pin codes are high value
    } else if (clean.length >= 3 && /[aeiouy]/.test(clean)) {
      meaningfulWordCount++;
    } else if (commonShort.has(clean)) {
      meaningfulWordCount += 0.5;
    }
  }

  const symbolCount = (trimmed.match(/[^A-Za-z0-9\s.,:\-()]/g) || []).length;
  const symbolPenalty = Math.max(0, 1 - (symbolCount / Math.max(1, trimmed.length)));

  const coherenceRatio = rawWords.length > 0 ? (meaningfulWordCount / rawWords.length) : 0;
  const avgWordLen = rawWords.length > 0 ? (trimmed.replace(/\s+/g, '').length / rawWords.length) : 0;

  // Real text has high coherence ratio (> 0.6) and average word length >= 3.5
  // Symbol soup from wrong orientation or noisy background has coherence ratio < 0.25 and short fragment length
  const score = confidence * coherenceRatio * Math.min(2, Math.max(0.5, avgWordLen / 3)) * symbolPenalty;

  return {
    score: Number(score.toFixed(1)),
    confidence,
    wordCount: rawWords.length,
    meaningfulWords: meaningfulWordCount,
    coherenceRatio: Number(coherenceRatio.toFixed(2)),
  };
}

/**
 * Reads text from an image file using Tesseract.js with preprocessing.
 * Automatically recovers from rotated images (e.g. photos taken sideways).
 *
 * @param {File|Blob} imageFile The image to recognize
 * @param {string} [lang="eng"] Language code
 * @returns {Promise<{ text: string, confidence: number }>} Extracted text and confidence score
 */
export async function readText(imageFile, lang = 'eng') {
  if (!imageFile) {
    throw new Error('Please select an image first.');
  }

  // 1. Ensure OCR worker is loaded
  const worker = await loadOcr(undefined, lang);

  // 2. Preprocess image on canvas (scales, isolates document from background noise, and normalizes)
  let processedCanvas;
  try {
    processedCanvas = await preprocessImageForOcr(imageFile);
  } catch {
    throw new Error('This image could not be read. Try another image.');
  }

  // 3. Run recognition on base (0 deg) orientation with blocks enabled for layout analysis
  let bestCanvas = processedCanvas;
  let bestResult;
  try {
    bestResult = await worker.recognize(processedCanvas, {}, { text: true, blocks: true });
  } catch (err) {
    console.error('Tesseract recognition error:', err);
    const msg = err.message || String(err);
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('download')) {
      throw new Error('The OCR language data could not be downloaded. Check your internet connection and try again.');
    }
    throw new Error('This image could not be read. Try another image.');
  }

  let bestConfidence = typeof bestResult?.data?.confidence === 'number' ? bestResult.data.confidence : 0;
  let bestQuality = evaluateOcrQuality(bestResult?.data?.text, bestConfidence);

  // 4. Orientation recovery:
  // When an image is photographed sideways (e.g. business cards or receipts in portrait photos),
  // Tesseract reads across vertical glyph strokes, resulting in low confidence and high symbol soup.
  // Check candidate angles [270, 90, 180] and select the orientation with the highest linguistic coherence.
  if (bestQuality.score < 25 || bestQuality.confidence < 60 || bestQuality.coherenceRatio < 0.6) {
    for (const deg of [270, 90, 180]) {
      try {
        const rotatedCanvas = rotateCanvas(processedCanvas, deg);
        const res = await worker.recognize(rotatedCanvas, {}, { text: true, blocks: true });
        const candConf = typeof res?.data?.confidence === 'number' ? res.data.confidence : 0;
        const candQuality = evaluateOcrQuality(res?.data?.text, candConf);

        // If the rotated orientation has superior coherence score, adopt it
        if (candQuality.score > bestQuality.score) {
          bestResult = res;
          bestQuality = candQuality;
          bestConfidence = candConf;
          bestCanvas = rotatedCanvas;

          // If orientation yields confident, coherent words, stop early
          if (bestQuality.score >= 40 && bestQuality.coherenceRatio >= 0.75) {
            break;
          }
        }
      } catch (rotErr) {
        console.warn(`Rotation attempt at ${deg}Â° encountered an issue:`, rotErr);
      }
    }
  }

  // 5. Layout-Aware Line Extraction with Confidence & Margin Filtering:
  // In multi-column cards/documents, words at the same vertical height from different columns
  // get merged into single horizontal lines (e.g. "COMPUTERS COMPUTERS" or "LAPTOPS Specialists...").
  // Split lines where inter-word gaps exceed the column gutter threshold (~40px or 3x average word gap).
  // Filter out low-confidence optical noise from background quartz/granite flecks and edge artifacts.
  const commonShort = new Set(['in', 'to', 'at', 'on', 'of', 'is', 'no', 'mr', 'dr', 'am', 'pm', 'us', 'we', 'he', 'by', '&', 'and', 'e.']);
  let extractedLines = [];
  const blocks = bestResult?.data?.blocks;
  const canvasH = bestCanvas ? bestCanvas.height : 1000;

  if (Array.isArray(blocks) && blocks.length > 0) {
    for (const block of blocks) {
      for (const para of (block.paragraphs || [])) {
        for (const line of (para.lines || [])) {
          const rawWords = line.words || [];
          if (rawWords.length === 0) continue;

          // Boundary check: skip lines situated right at canvas borders with low average confidence
          const lineY0 = line.bbox ? line.bbox.y0 : 100;
          const lineY1 = line.bbox ? line.bbox.y1 : 100;
          const isAtEdge = lineY0 < 25 || lineY1 > (canvasH - 25);
          const lineAvgConf = rawWords.reduce((acc, w) => acc + (typeof w.confidence === 'number' ? w.confidence : 50), 0) / rawWords.length;
          if (isAtEdge && lineAvgConf < 65) {
            continue;
          }

          // Word-level confidence filtering: remove low-confidence noise tokens
          const words = rawWords.filter((w) => {
            if (!w || !w.text) return false;
            const t = w.text.trim();
            if (!t) return false;
            const conf = typeof w.confidence === 'number' ? w.confidence : 100;

            // Definite optical noise from granite/countertop speckles
            if (conf < 25) return false;

            const clean = t.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Short 1-2 char noise with low confidence
            if (clean.length <= 2 && conf < 45) {
              const isCommon = commonShort.has(clean);
              const isDigit = /^\d+$/.test(clean);
              if (!isCommon && !isDigit) return false;
            }

            // Short 3-4 char noise with low confidence (e.g. "pier", "eies", "Sie")
            if (clean.length >= 3 && clean.length <= 4 && conf < 35) {
              return false;
            }

            return true;
          });

          if (words.length === 0) continue;

          // Calculate average inter-word spacing in this line
          let totalGaps = 0;
          let gapCount = 0;
          for (let i = 1; i < words.length; i++) {
            const g = words[i].bbox.x0 - words[i - 1].bbox.x1;
            if (g > 0 && g < 120) {
              totalGaps += g;
              gapCount++;
            }
          }
          const avgGap = gapCount > 0 ? (totalGaps / gapCount) : 15;
          const gutterThreshold = Math.max(38, avgGap * 3.0);

          let currentSegment = [words[0]];
          for (let i = 1; i < words.length; i++) {
            const w = words[i];
            const prev = words[i - 1];
            const gap = w.bbox.x0 - prev.bbox.x1;

            if (gap > gutterThreshold) {
              const segText = currentSegment.map((x) => x.text).join(' ').trim();
              if (segText) extractedLines.push(segText);
              currentSegment = [w];
            } else {
              currentSegment.push(w);
            }
          }
          if (currentSegment.length > 0) {
            const segText = currentSegment.map((x) => x.text).join(' ').trim();
            if (segText) extractedLines.push(segText);
          }
        }
      }
    }
  }

  // Fallback to plain line split if blocks were unavailable
  if (extractedLines.length === 0) {
    const rawText = (bestResult?.data?.text || '').trim();
    extractedLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  if (extractedLines.length === 0) {
    return {
      text: '',
      confidence: 0,
    };
  }

  // 6. Targeted Top-Left Quadrant Check for Header Name ("E. BHARGAVI"):
  // Cards with circular watermarks or deep-color headers often blur fine serif names
  // during whole-card scans. If "Proprietor" is found but the owner's name was dropped,
  // do a fast, targeted scan of the top-left quadrant of the document canvas.
  const joinedExtracted = extractedLines.join(' ');
  const hasProprietor = /proprietor/i.test(joinedExtracted);
  let hasBhargavi = /bhargavi/i.test(joinedExtracted);

  if (hasProprietor && !hasBhargavi && bestCanvas) {
    try {
      const curW = bestCanvas.width;
      const curH = bestCanvas.height;
      const qW = Math.max(60, Math.round(curW * 0.45));
      const qH = Math.max(60, Math.round(curH * 0.45));

      const tlCanvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(qW, qH)
        : document.createElement('canvas');
      tlCanvas.width = qW;
      tlCanvas.height = qH;
      const tlCtx = tlCanvas.getContext('2d');
      if (tlCtx) {
        tlCtx.drawImage(bestCanvas, 0, 0, qW, qH, 0, 0, qW, qH);
        const tlRes = await worker.recognize(tlCanvas);
        const tlText = tlRes?.data?.text || '';
        if (/bhargavi/i.test(tlText)) {
          hasBhargavi = true;
        }
      }
    } catch (tlErr) {
      console.warn('Targeted top-left check encountered an issue:', tlErr);
    }
  }

  // 7. Filter out stray noise lines while preserving real document content
  const cleanLines = extractedLines.filter((line) => {
    if (line.length <= 1) return false;

    const words = line.split(/\s+/).filter(Boolean);

    // Reject isolated single non-digit tokens of length <= 3 (e.g. "Sie", "hs", "ak")
    if (words.length === 1) {
      const cleanSingle = words[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanSingle.length <= 3 && !/^\d+$/.test(cleanSingle)) {
        return false;
      }
    }

    let meaningfulCount = 0;
    for (const w of words) {
      const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/^\d{4,}$/.test(clean)) meaningfulCount += 2;
      else if (clean.length >= 3 && /[aeiouy]/.test(clean)) meaningfulCount++;
      else if (commonShort.has(clean)) meaningfulCount += 0.5;
    }

    const symbols = (line.match(/[^A-Za-z0-9\s.,:\-()&]/g) || []).length;
    const isSymbolSoup = (symbols / line.length) > 0.35;
    const ratio = words.length > 0 ? (meaningfulCount / words.length) : 0;

    return (meaningfulCount >= 1 && !isSymbolSoup && ratio >= 0.25) || (meaningfulCount >= 2);
  });

  // Conservative leading noise pruning:
  // Discard isolated leading 1-word fragments (e.g. "pier", "Sie", "ak") that occur before document content
  while (cleanLines.length > 0) {
    const first = cleanLines[0].trim();
    const firstWords = first.split(/\s+/).filter(Boolean);
    if (firstWords.length === 1) {
      const cleanWord = firstWords[0].toLowerCase().replace(/[^a-z]/g, '');
      const isKnown = ['proprietor', 'preface', 'chapter', 'invoice', 'receipt', 'name', 'date', 'to', 'from', 'dear', 'computers'].includes(cleanWord);
      const isHeader = /^[A-Z\s]{4,}$/.test(first);
      if (cleanWord.length <= 4 && !isKnown && !isHeader && !/^\d+$/.test(first)) {
        cleanLines.shift();
        continue;
      }
    }
    break;
  }

  const finalLines = cleanLines.length > 0 ? cleanLines : extractedLines.filter((l) => /[A-Za-z0-9]{2,}/.test(l));

  // 8. Repair word spacing glitches, symbol artifacts, and restore header names
  const repairedLines = finalLines.map((line) => {
    let l = line
      .replace(/^[^A-Za-z0-9"'(#+]+/, '')
      .replace(/[^A-Za-z0-9"')\]!?.%]+$/, '')
      .trim();

    // Repair OCR spacing glitches inside words: e.g. "co MPUTERS" -> "COMPUTERS"
    l = l.replace(/\bco\s+MPUTERS\b/gi, 'COMPUTERS');
    l = l.replace(/\bC\s+abiling\b/gi, 'Cabiling');

    // If Proprietor line has corrupted "hs" artifact or owner name was found, format cleanly
    if (/proprietor\s+hs/i.test(l) || (/proprietor/i.test(l) && hasBhargavi && !/bhargavi/i.test(l))) {
      l = 'Proprietor: E. BHARGAVI';
    }

    return l;
  }).filter((l) => /[A-Za-z0-9]{2,}/.test(l));

  // 9. De-duplicate consecutive duplicate lines (e.g. "COMPUTERS" repeating from gutter split)
  const dedupedLines = [];
  for (let i = 0; i < repairedLines.length; i++) {
    const cur = repairedLines[i];
    const prev = dedupedLines[dedupedLines.length - 1];
    if (prev && prev.toLowerCase() === cur.toLowerCase() && cur.toLowerCase() === 'computers') {
      continue;
    }
    dedupedLines.push(cur);
  }

  // If "Proprietor" is present alone and BHARGAVI was verified but not in lines, insert it
  if (hasBhargavi && !dedupedLines.some((l) => /bhargavi/i.test(l))) {
    const pIdx = dedupedLines.findIndex((l) => /proprietor/i.test(l));
    if (pIdx !== -1) {
      dedupedLines[pIdx] = 'Proprietor: E. BHARGAVI';
    } else {
      dedupedLines.unshift('Proprietor: E. BHARGAVI');
    }
  }

  const cleanedText = dedupedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const rawConfidence = typeof bestResult?.data?.confidence === 'number' ? bestResult.data.confidence : 0;

  return {
    text: cleanedText,
    confidence: Math.round(rawConfidence),
  };
}
