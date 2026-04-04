import os
import json
from typing import Optional

SYSTEM_PROMPT = """You are Ocular AI, a sharp and reliable assistant that answers questions \
using ONLY the document excerpts provided below.

Rules:
- Base every answer strictly on the sources. Do not use outside knowledge.
- Cite sources inline like [filename.ext] immediately after the relevant fact.
- If the sources do not contain enough information, say so directly — never guess.
- Lead with the direct answer, then supporting detail.
- Use bullet points or numbered lists when listing multiple items.
- Keep answers concise and well-formatted using markdown.
"""

# Module-level singleton — created once, reused across all requests
_gemini_client = None


def _get_client():
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def _score_client_sources(question: str, sources: list, top_n: int = 5) -> list:
    """Rank client-sent sources by simple keyword relevance to the question.

    This filters the potentially hundreds of IndexedDB docs down to the most
    relevant handful before they're sent to Gemini.
    """
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
        content = (src.get("content") or "")[:3000]
        context_parts.append(f"--- Source {i}: {src['filename']} ---\n{content}\n")
    context_block = "\n".join(context_parts)
    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"== DOCUMENT SOURCES ==\n{context_block}== END SOURCES ==\n\n"
        f"User question: {question}"
    )


def stream_response(question: str, client_sources: Optional[list] = None):
    """Generator yielding SSE events: sources → tokens → done/error.

    Retrieval strategy (fastest path first):
    1. Server-side FTS5 search on the question → top 8 results from SQLite.
    2. From any client-sent sources (Google Drive / browser scan), score by
       keyword relevance → top 5.
    3. Merge both lists (server docs first), deduplicate by filepath, cap at 10.

    This means the AI only ever sees the most relevant documents, regardless
    of how many files are indexed.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        yield (
            f"event: error\ndata: {json.dumps({'message': 'Ocular AI is not configured. "
            f"Add GEMINI_API_KEY to your .env file.'})}\n\n"
        )
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

    sources = merged[:10]  # hard cap — keeps the prompt tight

    if not sources:
        yield (
            f"event: error\ndata: {json.dumps({'message': 'No relevant documents found. "
            f"Try indexing some files first.'})}\n\n"
        )
        return

    # Send source metadata to the frontend before streaming begins
    source_meta = [{"filename": s["filename"], "filepath": s["filepath"]} for s in sources]
    yield f"event: sources\ndata: {json.dumps(source_meta)}\n\n"

    prompt = build_prompt(question, sources)

    try:
        client = _get_client()
        response = client.models.generate_content_stream(
            model="gemini-2.0-flash",
            contents=prompt,
        )
        for chunk in response:
            if chunk.text:
                yield f"event: token\ndata: {json.dumps({'text': chunk.text})}\n\n"
        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "quota" in error_msg.lower():
            error_msg = "Rate limited by Gemini API. Please wait a moment and try again."
        # Reset the singleton so it's recreated cleanly on the next call
        global _gemini_client
        _gemini_client = None
        yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"
