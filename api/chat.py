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

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent"


class ChatSource(BaseModel):
    filename: str
    filepath: str
    content: str


class ChatRequest(BaseModel):
    question: str
    sources: list[ChatSource]


def build_prompt(question, sources):
    context_parts = []
    for i, src in enumerate(sources, 1):
        content = (src.get("content") or "")[:3000]
        context_parts.append(f"--- Source {i}: {src['filename']} ---\n{content}\n")
    context_block = "\n".join(context_parts)
    return f"""{SYSTEM_PROMPT}

== DOCUMENT SOURCES ==
{context_block}
== END SOURCES ==

User question: {question}"""


def stream_response(question, sources):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        yield f"event: error\ndata: {json.dumps({'message': 'Ocular AI is not configured yet.'})}\n\n"
        return

    if not sources:
        yield f"event: error\ndata: {json.dumps({'message': 'No relevant documents found. Index some files first.'})}\n\n"
        return

    source_list = [{"filename": s["filename"], "filepath": s["filepath"]} for s in sources]
    yield f"event: sources\ndata: {json.dumps(source_list)}\n\n"

    prompt = build_prompt(question, sources)

    try:
        for attempt in range(3):
            with httpx.stream(
                "POST",
                f"{GEMINI_URL}?alt=sse&key={api_key}",
                json={"contents": [{"parts": [{"text": prompt}]}]},
                headers={"Content-Type": "application/json"},
                timeout=60.0,
            ) as response:
                if response.status_code == 429 and attempt < 2:
                    response.read()
                    time.sleep(2 * (attempt + 1))
                    continue
                if response.status_code != 200:
                    response.read()
                    yield f"event: error\ndata: {json.dumps({'message': f'Gemini API error: {response.status_code}'})}\n\n"
                    return

                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        text = chunk.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        if text:
                            yield f"event: token\ndata: {json.dumps({'text': text})}\n\n"
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

                yield "event: done\ndata: {}\n\n"
                return

        yield f"event: error\ndata: {json.dumps({'message': 'Rate limited by Gemini API. Please wait a moment and try again.'})}\n\n"

    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "quota" in error_msg.lower():
            error_msg = "Rate limited by Gemini API. Please wait a moment and try again."
        yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"


@app.post("/api/chat")
def chat(request: ChatRequest):
    sources = [s.model_dump() for s in request.sources]
    return StreamingResponse(
        stream_response(request.question, sources),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/chat")
def health():
    return {"status": "ok", "service": "Ocular AI"}
