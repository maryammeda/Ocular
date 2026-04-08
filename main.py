import os
import asyncio
import logging
import mimetypes
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from backend.db import DocumentDB, _sanitize_fts_query
from backend.crawler import FileCrawler
from backend.watcher import FileWatcher

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ocular")

# Thread pool so crawl doesn't block the server
_pool = ThreadPoolExecutor(max_workers=2)

# File watcher — auto-reindexes on file changes
_watcher = FileWatcher()


@asynccontextmanager
async def lifespan(app):
    _watcher.start()
    yield
    _watcher.stop()


app = FastAPI(title="Ocular API", lifespan=lifespan)

# Enable CORS for React frontend
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ScanRequest(BaseModel):
    path: str
    deep_scan: bool = True


def _run_scan(path: str, deep_scan: bool):
    crawler = FileCrawler(path, deep_scan=deep_scan)
    return crawler.crawl()


@app.post("/scan")
async def scan(request: ScanRequest):
    if not os.path.isdir(request.path):
        raise HTTPException(status_code=400, detail=f"Invalid directory path: {request.path}")
    try:
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(_pool, _run_scan, request.path, request.deep_scan)
        _watcher.watch(request.path)
        return {"status": "Scan Complete", "files_indexed": len(results)}
    except Exception as e:
        log.exception("Scan failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search")
def search(query: str):
    db = DocumentDB()
    try:
        sanitized = _sanitize_fts_query(query)
        results = db.search(sanitized)
    except Exception as e:
        log.error("Search failed for query %r: %s", query, e)
        db.close()
        return []
    db.close()
    return [
        {
            "filename": row[0],
            "filepath": row[1],
            "snippet": row[2],
            "filetype": row[3],
            "matches": row[4],
        }
        for row in results
    ]


@app.post("/auto-scan")
async def auto_scan(deep_scan: bool = False):
    try:
        home = os.path.expanduser("~")
        folders = ["Desktop", "Downloads", "Documents"]
        total_indexed = 0
        scanned = []
        loop = asyncio.get_event_loop()

        for folder in folders:
            folder_path = os.path.join(home, folder)
            if os.path.isdir(folder_path):
                results = await loop.run_in_executor(_pool, _run_scan, folder_path, deep_scan)
                total_indexed += len(results)
                scanned.append(folder)
                _watcher.watch(folder_path)

        return {
            "status": "Scan Complete",
            "folders_scanned": scanned,
            "files_indexed": total_indexed,
        }
    except Exception as e:
        log.exception("Auto-scan failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/preview")
def preview(filepath: str):
    db = DocumentDB()
    row = db.get_document(filepath)
    db.close()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    filename, filepath, content, filetype = row
    ext = os.path.splitext(filename)[1].lower()
    is_image = ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')
    return {
        "filename": filename,
        "filepath": filepath,
        "content": content if not is_image else None,
        "filetype": filetype,
        "is_image": is_image,
        "image_url": f"/file?path={filepath}" if is_image else None,
    }


@app.get("/file")
def serve_file(path: str):
    path = os.path.normpath(os.path.abspath(path))
    allowed_dirs = _watcher.get_watched()
    if not allowed_dirs or not any(path.startswith(os.path.normpath(d)) for d in allowed_dirs):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type, _ = mimetypes.guess_type(path)
    return FileResponse(path, media_type=media_type or "application/octet-stream")


class ChatSource(BaseModel):
    filename: str
    filepath: str
    content: str

class ChatRequest(BaseModel):
    question: str
    sources: list[ChatSource] = []
    history: list[dict] = []

@app.post("/chat")
def chat(request: ChatRequest):
    from backend.rag import stream_response
    client_sources = [s.model_dump() for s in request.sources] if request.sources else None
    return StreamingResponse(
        stream_response(request.question, client_sources, history=request.history or None),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/watched")
def get_watched():
    return {"folders": _watcher.get_watched()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
