import os
import json
import time
import httpx
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI()

SYSTEM_PROMPT = """You are Ocular AI, an assistant that answers questions using ONLY the provided document excerpts.

Rules:
- Answer based solely on the sources below. Do not use outside knowledge.
- Cite filenames in your answer like [filename.ext] when referencing information.
- If the sources don't contain enough information to answer, say so honestly.
- Keep answers concise and well-formatted using markdown.
- Use bullet points or numbered lists when listing multiple items.
"""

OPENROUTER_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"


class ChatSource(BaseModel):
    filename: str
    filepath: str
    content: str


class ChatRequest(BaseModel):
    question: str
    sources: list[ChatSource] = []
    history: list[dict] = []


def _top_sources(question: str, sources: list, top_n: int = 8) -> list:
    """Score sources by keyword relevance and return the top N most relevant."""
    words = [w.lower() for w in question.split() if len(w) > 3]
    if not words:
        return sources[:top_n]
    scored = []
    for s in sources:
        content_lower = (s.get("content") or "").lower()
        score = sum(content_lower.count(w) for w in words)
        scored.append((score, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    relevant = [s for sc, s in scored if sc > 0]
    return (relevant or [s for _, s in scored])[:top_n]


def build_context(question, sources):
    context_parts = []
    for i, src in enumerate(sources, 1):
        content = (src.get("content") or "")[:3000]
        context_parts.append(f"--- Source {i}: {src['filename']} ---\n{content}\n")
    context_block = "\n".join(context_parts)
    return f"""== DOCUMENT SOURCES ==
{context_block}
== END SOURCES ==

User question: {question}"""


def stream_response(question, sources, history=None):
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        yield f"event: error\ndata: {json.dumps({'message': 'Ocular AI is not configured yet.'})}\n\n"
        return

    if not sources:
        yield f"event: error\ndata: {json.dumps({'message': 'No relevant documents found. Index some files first.'})}\n\n"
        return

    sources = _top_sources(question, sources, top_n=8)

    source_list = [{"filename": s["filename"], "filepath": s["filepath"]} for s in sources]
    yield f"event: sources\ndata: {json.dumps(source_list)}\n\n"

    user_content = build_context(question, sources)

    # Build message thread: system → past exchanges → current question
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_content})

    try:
        for attempt in range(3):
            with httpx.stream(
                "POST",
                OPENROUTER_URL,
                json={
                    "model": MODEL,
                    "stream": True,
                    "messages": messages,
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=9.0,  # Stay under Vercel Hobby's 10s function limit
            ) as response:
                if response.status_code == 429 and attempt < 2:
                    response.read()
                    time.sleep(2 * (attempt + 1))
                    continue
                if response.status_code != 200:
                    response.read()
                    yield f"event: error\ndata: {json.dumps({'message': f'API error: {response.status_code}'})}\n\n"
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
                        # Surface any error the model returns inside the payload
                        if chunk.get("error"):
                            err = chunk["error"]
                            msg = err.get("message") or str(err)
                            yield f"event: error\ndata: {json.dumps({'message': f'OpenRouter error: {msg}'})}\n\n"
                            return
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        text = delta.get("content", "")
                        if text:
                            tokens_received += 1
                            yield f"event: token\ndata: {json.dumps({'text': text})}\n\n"
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

                if tokens_received == 0:
                    yield f"event: error\ndata: {json.dumps({'message': 'The AI returned an empty response. The model may be overloaded or rate-limited — try again in a moment.'})}\n\n"
                    return

                yield "event: done\ndata: {}\n\n"
                return

        yield f"event: error\ndata: {json.dumps({'message': 'Rate limited. Please wait a moment and try again.'})}\n\n"

    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "quota" in error_msg.lower():
            error_msg = "Rate limited. Please wait a moment and try again."
        elif "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
            error_msg = "The AI took too long to respond. Try asking a shorter question or try again."
        yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"


@app.post("/api/chat")
def chat(request: ChatRequest):
    sources = [s.model_dump() for s in request.sources]
    return StreamingResponse(
        stream_response(request.question, sources, history=request.history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/chat")
def health():
    return {"status": "ok", "service": "Ocular AI"}
