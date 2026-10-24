# Personal AI Companion

An accessible, voice-first on-device AI assistant designed to help users—including individuals with visual impairments—understand scenes, read documents and labels, ask questions about images, and navigate tasks through speech.

Built with **React + Vite**, running 100% locally in the browser with **WebGPU** acceleration and zero backend dependencies.

---

## ✨ Features

- **Scene & Object Description:** High-quality visual scene reasoning powered by `SmolVLM-500M-Instruct` running entirely client-side via Transformers.js in a dedicated Web Worker (WebGPU primary, WASM fallback).
- **On-Device Document & Label OCR:** Fast, privacy-preserving text extraction for signs, receipts, labels, and business cards powered by Tesseract.js v7 with intelligent image preprocessing (adaptive contrast, document isolation, orientation handling).
- **Text-Grounded Question Answering:** Dedicated Q&A routing that combines OCR and visual reasoning to answer specific questions (e.g. phone numbers, business names, addresses) without hallucinating unreadable details.
- **Accessible Voice & Speech Controls:** Natural browser-based speech synthesis with integrated Play, Pause, Resume, and Stop reading controls.
- **Accessible High-Contrast Design:** WCAG AAA high-contrast dark palette with yellow accents (`#ffd400`), keyboard-friendly navigation, skip links, and polite screen-reader announcements.

---

## 🛠️ Architecture & Tech Stack

- **Framework:** React 19 + Vite (pure JavaScript)
- **Styling:** Modular Vanilla CSS design system with strict accessibility landmarks
- **Vision Model:** `HuggingFaceTB/SmolVLM-500M-Instruct` (quantized ONNX, executed in a Web Worker)
- **OCR Engine:** `tesseract.js` (WebAssembly worker)
- **Speech Synthesis:** Browser Web Speech API (`window.speechSynthesis`)
- **Backend / Database:** None (100% on-device client execution; no `.env` or external API keys needed)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **Browser:** Modern desktop browser with WebGPU support (**Google Chrome** or **Microsoft Edge** recommended)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/shanmukhakovvuri/ai-companion.git
   cd ai-companion
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173/` in your browser.

4. Build for production:
   ```bash
   npm run build
   ```
   The production-ready assets will be generated in the `dist/` directory.

5. Preview the production build:
   ```bash
   npm run preview
   ```

---

## 📋 Available Scripts

- `npm run dev` — Launches Vite local development server with Hot Module Replacement (HMR).
- `npm run build` — Compiles and bundles production assets into `dist/`.
- `npm run lint` — Runs ESLint across the codebase.
- `npm run preview` — Serves the local production build for testing.

---

## 🔒 Privacy & Security

- **Zero Cloud Data Transmission:** All image analysis, optical character recognition, and text-to-speech are performed directly inside your browser on your device.
- **No Credentials Required:** No API keys, tokens, or environment configurations are stored or needed.
