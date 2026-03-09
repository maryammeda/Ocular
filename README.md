# Ocular - Computer Vision & Local Search Engine

![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)

## The Problem
University students generate thousands of files, PDFs, and screenshots of lecture whiteboards. While standard OS search engines (like Windows Search or Mac Spotlight) can find filenames, they are completely blind to the actual content locked inside images and screenshots. Data gets lost.

## The Solution
**Ocular** is a headless local search engine designed to give your computer "eyes."
It utilizes an automated ETL pipeline and **Tesseract OCR (Optical Character Recognition)** to read, extract, and index text directly from images, screenshots, and PDFs. Coupled with an **SQLite FTS5 (Full-Text Search)** database, Ocular delivers sub-millisecond, content-based search results with contextual text snippets.

---

## ⚙️ Core Architecture & Features

*   **Computer Vision Pipeline:** Integrates Tesseract OCR to automatically extract unsearchable text from local `.png` and `.jpg` whiteboard photos.
*   **High-Performance Querying:** Built on SQLite FTS5 to bypass standard row-scanning, enabling instant retrieval and keyword highlighting.
*   **Multithreaded Crawler:** Utilizes Python `ThreadPoolExecutor` to rapidly crawl the file system, bypassing system folders and optimizing image sizes on the fly to prevent CPU bottlenecks.
*   **Headless API:** A fully decoupled architecture using **FastAPI** to serve search logic, allowing for highly customizable frontends.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Python, FastAPI, Uvicorn |
| **Database** | SQLite (FTS5 Extension) |
| **Data Extraction** | Tesseract OCR, PyPDF2, Pillow |
| **Frontend** *(In-Progress)* | React.js, TailwindCSS, Framer Motion |

---

## 🗺️ Roadmap

- [x] Phase 1: Build Multithreaded Crawler & OCR Pipeline
- [x] Phase 2: Implement SQLite FTS5 Database
- [x] Phase 3: Migrate to Headless FastAPI Architecture
- [ ] Phase 4: Develop Interactive React.js Frontend with Knowledge Graph visualization

---

> *"Building a Second Brain, one pixel at a time."*
