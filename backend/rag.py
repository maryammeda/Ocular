import os
import json

SYSTEM_PROMPT = """You are Ocular AI, an assistant that answers questions using ONLY the provided document excerpts.

Rules:
- Answer based solely on the sources below. Do not use outside knowledge.
- Cite filenames in your answer like [filename.ext] when referencing information.
- If the sources don't contain enough information to answer, say so honestly.
- Keep answers concise and well-formatted using markdown.
- Use bullet points or numbered lists when listing multiple items.
"""


def build_prompt(question, sources):
    """Assemble the prompt with document excerpts and user question."""
    context_parts = []
    for i, src in enumerate(sources, 1):
        content = (src.get("content") or "")[:3000]
        context_parts.append(
            f"--- Source {i}: {src['filename']} ---\n{content}\n"
        )
    context_block = "\n".join(context_parts)

    return f"""{SYSTEM_PROMPT}

== DOCUMENT SOURCES ==
{context_block}
== END SOURCES ==

User question: {question}"""


def stream_response(question, sources):
    """Generator yielding SSE events: sources, tokens, done/error.

    `sources` is a list of dicts with keys: filename, filepath, content
    (sent from the frontend which holds docs in IndexedDB).
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        yield f"event: error\ndata: {json.dumps({'message': 'Ocular AI is not configured yet. The server admin needs to set GEMINI_API_KEY.'})}\n\n"
        return

    if not sources:
        yield f"event: error\ndata: {json.dumps({'message': 'No relevant documents found. Index some files first.'})}\n\n"
        return

    # Send source metadata first
    source_list = [{"filename": s["filename"], "filepath": s["filepath"]} for s in sources]
    yield f"event: sources\ndata: {json.dumps(source_list)}\n\n"

    prompt = build_prompt(question, sources)

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
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
        yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"
