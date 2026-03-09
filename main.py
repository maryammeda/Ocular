import os
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.db import DocumentDB
from backend.crawler import FileCrawler

app = FastAPI(title="Neural Search API")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    path: str
    deep_scan: bool = True


@app.post("/scan")
def scan(request: ScanRequest):
    if not os.path.isdir(request.path):
        return {"status": "error", "message": "Invalid directory path."}
    crawler = FileCrawler(request.path, deep_scan=request.deep_scan)
    results = crawler.crawl()
    return {"status": "Scan Complete", "files_indexed": len(results)}


@app.get("/search")
def search(q: str):
    db = DocumentDB()
    results = db.search(q)
    db.close()
    return [
        {
            "filename": row[0],
            "filepath": row[1],
            "snippet": row[2],
            "filetype": row[3],
        }
        for row in results
    ]


@app.post("/auto-scan")
def auto_scan(deep_scan: bool = False):
    home = os.path.expanduser("~")
    folders = ["Desktop", "Downloads", "Documents"]
    total_indexed = 0
    scanned = []

    for folder in folders:
        folder_path = os.path.join(home, folder)
        if os.path.isdir(folder_path):
            crawler = FileCrawler(folder_path, deep_scan=deep_scan)
            results = crawler.crawl()
            total_indexed += len(results)
            scanned.append(folder)

    return {
        "status": "Scan Complete",
        "folders_scanned": scanned,
        "files_indexed": total_indexed,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
