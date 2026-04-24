# Ocular

**Live:** [ocular-app.tech](https://ocular-app.tech)

A personal AI search engine that reads every word inside your files — PDFs, screenshots, Google Docs, scans, receipts — and lets you chat with them. 100% client-side. Nothing leaves your device.

![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

---

## Why

Your OS search bar is blind to what's inside your files. It finds filenames, not content. The lecture slide you screenshotted last month? The invoice from March? The PDF you saved and forgot about? Invisible to regular search.

Ocular reads all of it — and lets you ask questions about it.

## What it does

- **Search everything by content.** Screenshots, PDFs, DOCX, Google Docs/Sheets, images — the text inside them, not just filenames.
- **Chat with your files.** Ask natural questions and get cited answers streamed back live. Every claim links to the source document.
- **Index from anywhere.** Any folder on your computer, specific files from Google Drive via Picker, or your entire Drive via Drive for Desktop at native filesystem speed.
- **100% private.** Runs entirely in your browser. No accounts, no uploads, no server storing your files.

## Architecture

### Frontend (client-side, where everything actually happens)
- **React + Vite** — UI and build tooling
- **IndexedDB** — persistent document index, built and queried in the browser
- **Tesseract.js (WASM)** — OCR on images with adaptive-worker pipelined parallelism
- **File System Access API** — direct folder access without uploads
- **TF-IDF retrieval** — keyword search ranked by log-scaled term frequency × inverse document frequency
- **Google Drive Picker + OAuth2** — for selective cloud indexing

### Backend (serverless chat only)
- **FastAPI on Vercel** — stateless `/api/chat` endpoint
- **Multi-provider LLM fallback** — Groq LLaMA 3.1 8B primary, Cerebras Qwen 3 235B + Cerebras Llama 8B + Gemini 2.5 Flash fallbacks
- **Streaming SSE** — tokens streamed as they're generated
- **RAG retrieval** — top-K most relevant document chunks injected as context per query

### Why 100% client-side for indexing?
Because user files never need to leave the device. OCR, extraction, and storage all happen in the browser. The chat endpoint only ever sees the specific snippets needed to answer a single question — never the full index, never the raw files.

## Scan methods

1. **Local folder scan** — pick any folder; Ocular indexes everything with supported extensions (PDFs, DOCX, images, text).
2. **Google Drive Picker** — pick specific files from Drive. Uses `drive.file` scope so there's no "unverified app" warning.
3. **Drive for Desktop** — point Ocular at your `G:\My Drive` (or Mac equivalent) folder. Drive for Desktop syncs files locally, and Ocular indexes them as normal local files. Fastest method, zero OAuth, zero scope concerns.

## Running locally

### Prerequisites
- Python 3.9+
- Node.js 18+
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (for server-side dev; browser uses Tesseract.js)

### Setup

```bash
git clone https://github.com/maryammeda/Ocular.git
cd Ocular

# Backend
python -m venv venv
source venv/bin/activate    # or venv\Scripts\activate on Windows
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..
```

### Environment variables

Create `.env` in the project root:
```env
GROQ_API_KEY=your_groq_key
CEREBRAS_API_KEY=your_cerebras_key     # optional fallback
GEMINI_API_KEY=your_gemini_key         # optional fallback
```

Create `frontend/.env`:
```env
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
VITE_GOOGLE_API_KEY=your_google_api_key
```

Free API keys:
- Groq: [console.groq.com](https://console.groq.com)
- Cerebras: [cloud.cerebras.ai](https://cloud.cerebras.ai)
- Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Run

```bash
python start.py
```

Starts FastAPI backend on `:8000` and Vite dev server on `:5173`.

## Deployment

The production site (`ocular-app.tech`) is deployed on Vercel. `vercel.json` configures the frontend build and serverless chat endpoint. Set the same env vars listed above in Vercel's project settings.

## Tech stack summary

| Layer | Tech |
|---|---|
| Frontend | React, Vite, TailwindCSS, Framer Motion |
| Client storage | IndexedDB |
| OCR | Tesseract.js (WASM) |
| File access | File System Access API |
| Backend | FastAPI (Vercel serverless) |
| LLM providers | Groq, Cerebras, Gemini (multi-tier fallback) |
| Auth (optional) | Google OAuth2 + Picker API |

## License

MIT — see [LICENSE](./LICENSE).
