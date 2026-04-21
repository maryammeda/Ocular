import os
import sys
import json
import time
import httpx
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Import shared prompt — with fallback for Vercel serverless
try:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from backend.prompts import SYSTEM_PROMPT
except ImportError:
    # Fallback: read directly from file (Vercel deploys full repo)
    _prompt_path = os.path.join(os.path.dirname(__file__), "..", "backend", "prompts.py")
    if os.path.exists(_prompt_path):
        _ns = {}
        exec(open(_prompt_path).read(), _ns)
        SYSTEM_PROMPT = _ns["SYSTEM_PROMPT"]
    else:
        SYSTEM_PROMPT = "You are Ocular AI, a personal document assistant. Answer based solely on the provided sources. Cite filenames like [filename.ext]. Keep answers concise using markdown."

app = FastAPI()

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"

# Cerebras runs the same Llama models with 2x Groq's TPM (60k vs 30k).
# Different quota pool, so it picks up when Groq is saturated.
CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
# Default/free-tier Cerebras keys only have access to llama3.1-8b.
# Verified working via direct API test. Matches Groq's primary model.
CEREBRAS_MODEL = "llama3.1-8b"

# Gemini exposes an OpenAI-compatible endpoint. Third-tier fallback with its own quota pool.
# Note: 2.0 Flash is existing-customers-only as of March 2026; 2.5 Flash is available to new accounts.
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_MODEL = "gemini-2.5-flash"


class ChatSource(BaseModel):
    filename: str
    filepath: str
    content: str


class ChatRequest(BaseModel):
    question: str
    sources: list[ChatSource] = []
    history: list[dict] = []


def _top_sources(question: str, sources: list, top_n: int = 6) -> list:
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
        content = (src.get("content") or "")[:2000]
        context_parts.append(f"--- Source {i}: {src['filename']} ---\n{content}\n")
    context_block = "\n".join(context_parts)
    return f"""== DOCUMENT SOURCES ==
{context_block}
== END SOURCES ==

User question: {question}"""


def _try_provider(url, api_key, model, messages, timeout=9.0):
    """Attempt to stream from an OpenAI-compatible provider.

    Yields tuples: ('ratelimit', None) if 429, ('error', msg) on other errors,
    ('token', text) for each streamed content chunk, ('done', None) on completion.
    """
    try:
        with httpx.stream(
            "POST",
            url,
            json={"model": model, "stream": True, "messages": messages},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=timeout,
        ) as response:
            if response.status_code == 429:
                response.read()
                yield ("ratelimit", None)
                return
            # 503 is transient overload — treat like rate-limit so chain falls over to next provider
            if response.status_code == 503:
                response.read()
                yield ("ratelimit", None)
                return
            if response.status_code != 200:
                response.read()
                yield ("error", f"API error: {response.status_code}")
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
                        yield ("error", err.get("message") or str(err))
                        return
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    text = delta.get("content", "")
                    if text:
                        tokens_received += 1
                        yield ("token", text)
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue

            if tokens_received == 0:
                yield ("error", "empty_response")
                return
            yield ("done", None)
    except Exception as e:
        msg = str(e)
        if "429" in msg or "quota" in msg.lower():
            yield ("ratelimit", None)
        else:
            yield ("error", msg)


def stream_response(question, sources, history=None):
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    cerebras_key = os.getenv("CEREBRAS_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not any([groq_key, cerebras_key, gemini_key]):
        yield f"event: error\ndata: {json.dumps({'message': 'Ocular AI is not configured yet.'})}\n\n"
        return

    if not sources:
        yield f"event: error\ndata: {json.dumps({'message': 'No relevant documents found. Index some files first.'})}\n\n"
        return

    sources = _top_sources(question, sources, top_n=6)

    source_list = [{"filename": s["filename"], "filepath": s["filepath"]} for s in sources]
    yield f"event: sources\ndata: {json.dumps(source_list)}\n\n"

    user_content = build_context(question, sources)

    # Build message thread: system → past exchanges → current question
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_content})

    # Build provider chain — each has an independent quota pool.
    # Order: Groq (fastest) → Cerebras (2x Groq's TPM, same Llama models) → Gemini (1M TPM ceiling).
    providers = []
    if groq_key:
        providers.append(("Groq", GROQ_URL, groq_key, GROQ_MODEL))
    if cerebras_key:
        providers.append(("Cerebras", CEREBRAS_URL, cerebras_key, CEREBRAS_MODEL))
    if gemini_key:
        providers.append(("Gemini", GEMINI_URL, gemini_key, GEMINI_MODEL))

    # Track what happened with each provider for debugging
    provider_outcomes = []
    for provider_name, url, key, model in providers:
        any_token = False
        outcome = None
        for event_type, payload in _try_provider(url, key, model, messages):
            if event_type == "token":
                any_token = True
                yield f"event: token\ndata: {json.dumps({'text': payload})}\n\n"
            elif event_type == "done":
                yield "event: done\ndata: {}\n\n"
                return
            elif event_type == "ratelimit":
                outcome = f"{provider_name}: rate-limited"
                break
            elif event_type == "error":
                outcome = f"{provider_name}: {payload}"
                if any_token:
                    # Already streamed partial response, can't fail over
                    yield f"event: error\ndata: {json.dumps({'message': outcome})}\n\n"
                    return
                break
        if outcome:
            provider_outcomes.append(outcome)

    # All providers exhausted — surface the full chain of failures
    final_msg = "All AI providers failed: " + " | ".join(provider_outcomes) if provider_outcomes else "No AI providers configured."
    yield f"event: error\ndata: {json.dumps({'message': final_msg})}\n\n"


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
