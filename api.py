"""Lightweight API server for cloud deployment (Render, Railway, etc.).

Only exposes the /chat endpoint — the Gemini streaming proxy.
No local file crawling, no SQLite, no file watcher.
"""
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Ocular AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/health")
def health():
    return {"status": "ok"}
