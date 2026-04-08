# Ocular - AI-Powered Personal Search Engine

![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

## The Problem
University students generate thousands of files, PDFs, and screenshots of lecture whiteboards. While standard OS search engines (like Windows Search or Mac Spotlight) can find filenames, they are completely blind to the actual content locked inside images and screenshots. Data gets lost.

## The Solution
**Ocular** is a local search engine designed to give your computer "eyes."
It uses an automated ETL pipeline and **Tesseract OCR** to read, extract, and index text directly from images, screenshots, PDFs, and documents. Paired with **SQLite FTS5** and a client-side **IndexedDB** engine, Ocular delivers sub-millisecond, content-based search results with contextual snippets and keyword highlighting. An AI chat assistant powered by **Groq LLaMA 3.3 70B** lets you ask questions about your documents with cited, source-backed answers.

---

## Core Architecture & Features

### Search & Indexing
*   **Dual Search Architecture:** Server-side SQLite FTS5 for production queries and client-side IndexedDB for offline, browser-based search — both running in parallel.
*   **High-Performance Querying:** FTS5 bypasses standard row-scanning for instant retrieval with keyword highlighting, match counting, and relevance ranking.
*   **Search History:** Persisted search queries with dropdown suggestions, deduplication, and individual deletion.

### Computer Vision & Content Extraction
*   **OCR Pipeline:** Tesseract OCR (server-side via pytesseract, client-side via Tesseract.js with a 2-worker pool) extracts text from `.png`, `.jpg`, and `.jpeg` images.
*   **Multi-Format Support:** Processes text files (`.txt`, `.md`, `.csv`), documents (`.pdf`, `.docx`), and images — all indexed and searchable.
*   **Smart Image Optimization:** Skips images under 30 KB, auto-resizes large images, and converts to greyscale for faster OCR processing.

### AI Chat Assistant
*   **RAG Pipeline:** Retrieves relevant documents via FTS5, scores and merges with client-side sources, then streams answers from Groq LLaMA 3.3 70B.
*   **Source Citations:** Every answer cites the specific files it draws from as `[filename.ext]`.
*   **Multi-Conversation:** Maintains separate chat threads with history, persisted to localStorage.
*   **Streaming Responses:** Server-Sent Events deliver tokens in real time.

### File System Integration
*   **Multithreaded Crawler:** Uses Python `ThreadPoolExecutor` to rapidly crawl the file system, bypassing system folders and optimizing throughput.
*   **Real-Time File Watcher:** Automatically re-indexes files on create, modify, or delete using `watchdog` with a 2-second debounce — no manual re-scans needed.
*   **Drag & Drop Scanning:** Drop files or folders directly onto the app to index them instantly.
*   **Folder Picker:** Uses the File System Access API for native folder selection.

### Google Drive Integration
*   **OAuth2 Authentication:** Connects to Google Drive via Google Identity Services.
*   **Workspace Export:** Automatically exports Google Docs to plain text and Sheets to CSV before indexing.
*   **Batch Processing:** Downloads and processes files in batches with per-file error handling and retry logic.
*   **Supported Types:** PDFs, Docs, Sheets, Word documents, and images (with automatic OCR).

### Frontend
*   **Glassmorphism UI:** Modern frosted-glass design with backdrop blur, animated gradients, and Framer Motion transitions.
*   **Document Preview:** Hover to preview images as thumbnails or view full document content with keyword highlighting.
*   **Toast Notifications:** Auto-dismissing success/error messages for scan progress and results.

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Python, FastAPI, Uvicorn |
| **Database** | SQLite (FTS5), IndexedDB (client-side) |
| **AI** | Groq LLaMA 3.3 70B (via OpenAI-compatible API) |
| **Content Extraction** | Tesseract OCR, pytesseract, Tesseract.js, pdfplumber, python-docx, Pillow |
| **File Watching** | watchdog |
| **Frontend** | React 19, Vite, TailwindCSS, Framer Motion |
| **Icons** | Lucide React |
| **Client-Side Processing** | pdfjs-dist, mammoth, Tesseract.js |
| **Cloud** | Google Drive API (OAuth2) |
| **Deployment** | Vercel (frontend + serverless chat) |

---

## Getting Started

### Prerequisites
- Python 3.9+
- Node.js 18+
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) installed and on PATH

### Installation

```bash
# Clone the repository
git clone https://github.com/maryammeda/Ocular.git
cd Ocular

# Set up Python virtual environment
python -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows

# Install backend dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### Configuration

**Backend** — create `.env` in the project root:
```env
GROQ_API_KEY=your_groq_api_key_here
```

**Frontend** — create `frontend/.env`:
```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_GOOGLE_API_KEY=your_google_api_key
```

Get a free Groq API key at [console.groq.com](https://console.groq.com).

### Running

```bash
# Start both backend and frontend
python start.py
```

This launches the FastAPI backend on `http://localhost:8000` and the React frontend on `http://localhost:5173`.

---

## Deployment

### Vercel (Frontend + Chat)
The project includes a `vercel.json` that deploys the React frontend and the serverless chat endpoint (`api/chat.py`). Set `GROQ_API_KEY` in your Vercel environment variables.

### Self-Hosted (Full Stack)
Run `python start.py` on your server. The backend provides file scanning, search, preview, and chat — the frontend connects to it automatically.

---

## Roadmap

- [x] Phase 1: Multithreaded Crawler & OCR Pipeline
- [x] Phase 2: SQLite FTS5 Database
- [x] Phase 3: Headless FastAPI Architecture
- [x] Phase 4: Interactive React Frontend with Glassmorphism UI
- [x] Phase 5: Real-Time File Watcher (auto re-indexing)
- [x] Phase 6: Google Drive Integration (OAuth2 + batch processing)
- [x] Phase 7: Client-Side IndexedDB Engine (offline search)
- [x] Phase 8: Document Preview & Search History
- [x] Phase 9: AI Chat Assistant (RAG + Groq LLaMA 3.3)

---

> *"Building a Second Brain, one pixel at a time."*
