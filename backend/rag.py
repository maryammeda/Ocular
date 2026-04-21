import os
import json
import time
from typing import Optional

import httpx

from backend.prompts import SYSTEM_PROMPT

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.1-8b-instant"


def _sse(event, data):
    """Format a Server-Sent Event line."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _score_client_sources(question: str, sources: list, top_n: int = 5) -> list:
    """Rank client-sent sources by simple keyword relevance to the question."""
    words = [w.lower() for w in question.split() if len(w) > 3]
    if not words:
        return sources[:top_n]
    scored = []
    for s in sources:
        content_lower = (s.get("content") or "").lower()
        score = sum(content_lower.count(w) for w in words)
        if score > 0:
            scored.append((score, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in scored[:top_n]]


def build_prompt(question: str, sources: list) -> str:
    context_parts = []
    for i, src in enumerate(sources, 1):
        content = (src.get("content") or "")[:2000]
        context_parts.append(f"--- Source {i}: {src['filename']} ---\n{content}\n")
    context_block = "\n".join(context_parts)
    return (
        f"== DOCUMENT SOURCES ==\n{context_block}"
        f"== END SOURCES ==\n\n"
        f"User question: {question}"
    )


def stream_response(question: str, client_sources: Optional[list] = None, history: Optional[list] = None):
    """Generator yielding SSE events: sources -> tokens -> done/error.

    Retrieval strategy (fastest path first):
    1. Server-side FTS5 search on the question -> top 8 results from SQLite.
    2. From any client-sent sources (Google Drive / browser scan), score by
       keyword relevance -> top 5.
    3. Merge both lists (server docs first), deduplicate by filepath, cap at 10.
    """
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        yield _sse("error", {"message": "Ocular AI is not configured. Add GROQ_API_KEY to your .env file."})
        return

    # 1. Server-side retrieval
    server_docs = []
    try:
        from backend.db import DocumentDB
        db = DocumentDB()
        server_docs = db.get_relevant_docs(question, limit=8)
        db.close()
    except Exception:
        pass  # DB unavailable — fall back to client sources

    # 2. Relevance-filter client sources
    client_docs = []
    if client_sources:
        client_docs = _score_client_sources(question, client_sources, top_n=5)

    # 3. Merge: server results have priority; add non-duplicate client docs after
    seen_paths = {d["filepath"] for d in server_docs}
    merged = list(server_docs)
    for doc in client_docs:
        if doc["filepath"] not in seen_paths:
            merged.append(doc)
            seen_paths.add(doc["filepath"])

    sources = merged[:10]

    if not sources:
        yield _sse("error", {"message": "No relevant documents found. Try indexing some files first."})
        return

    # Send source metadata to the frontend before streaming begins
    source_meta = [{"filename": s["filename"], "filepath": s["filepath"]} for s in sources]
    yield _sse("sources", source_meta)

    user_content = build_prompt(question, sources)

    # Build message thread: system -> past exchanges -> current question
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_content})

    try:
        for attempt in range(3):
            with httpx.stream(
                "POST",
                GROQ_URL,
                json={
                    "model": MODEL,
                    "stream": True,
                    "messages": messages,
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=30.0,
            ) as response:
                if response.status_code == 429 and attempt < 2:
                    response.read()
                    time.sleep(2 * (attempt + 1))
                    continue
                if response.status_code != 200:
                    response.read()
                    yield _sse("error", {"message": f"API error: {response.status_code}"})
                    return

                tokens_received = 0
                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        if chunk.get("error"):
                            err = chunk["error"]
                            err_msg = err.get("message") or str(err)
                            yield _sse("error", {"message": err_msg})
                            return
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        text = delta.get("content", "")
                        if text:
                            tokens_received += 1
                            yield _sse("token", {"text": text})
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

                if tokens_received == 0:
                    yield _sse("error", {"message": "The AI returned an empty response. The model may be overloaded — try again in a moment."})
                    return

                yield _sse("done", {})
                return

        yield _sse("error", {"message": "Rate limited. Please wait a moment and try again."})

    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "quota" in error_msg.lower():
            error_msg = "Rate limited. Please wait a moment and try again."
        elif "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
            error_msg = "The AI took too long to respond. Try asking a shorter question or try again."
        yield _sse("error", {"message": error_msg})
