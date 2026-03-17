import os
import mimetypes
import traceback
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from backend.db import DocumentDB
from backend.crawler import FileCrawler
from backend.watcher import FileWatcher

load_dotenv()

app = FastAPI(title="Neural Search API")

# Thread pool so crawl doesn't block the server
_pool = ThreadPoolExecutor(max_workers=2)

# File watcher — auto-reindexes on file changes
_watcher = FileWatcher()

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    _watcher.start()


@app.on_event("shutdown")
def shutdown():
    _watcher.stop()


class ScanRequest(BaseModel):
    path: str
    deep_scan: bool = True


def _run_scan(path: str, deep_scan: bool):
    crawler = FileCrawler(path, deep_scan=deep_scan)
    return crawler.crawl()


@app.post("/scan")
async def scan(request: ScanRequest):
    try:
        if not os.path.isdir(request.path):
            return {"status": "error", "message": f"Invalid directory path: {request.path}"}
        import asyncio
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(_pool, _run_scan, request.path, request.deep_scan)
        # Auto-watch the scanned folder
        _watcher.watch(request.path)
        return {"status": "Scan Complete", "files_indexed": len(results)}
    except Exception as e:
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


@app.get("/search")
def search(query: str):
    db = DocumentDB()
    results = db.search(query)
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
        import asyncio
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
                # Auto-watch scanned folders
                _watcher.watch(folder_path)

        return {
            "status": "Scan Complete",
            "folders_scanned": scanned,
            "files_indexed": total_indexed,
        }
    except Exception as e:
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


@app.get("/preview")
def preview(filepath: str):
    db = DocumentDB()
    row = db.get_document(filepath)
    db.close()
    if not row:
        return {"status": "error", "message": "Document not found"}
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
    path = os.path.normpath(path)
    if not os.path.isfile(path):
        return {"status": "error", "message": "File not found"}
    media_type, _ = mimetypes.guess_type(path)
    return FileResponse(path, media_type=media_type or "application/octet-stream")


class ChatSource(BaseModel):
    filename: str
    filepath: str
    content: str

class ChatRequest(BaseModel):
    question: str
    sources: list[ChatSource]

@app.post("/chat")
def chat(request: ChatRequest):
    from backend.rag import stream_response
    sources = [s.model_dump() for s in request.sources]
    return StreamingResponse(
        stream_response(request.question, sources),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/watched")
def get_watched():
    return {"folders": _watcher.get_watched()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
