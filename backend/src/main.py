"""FastAPI WebSocket server - bridges browser audio stream to the pipeline.

Protocol:
1. Client connects, sends one JSON text message: {"target_language": "Hindi"}
2. Client then streams raw 48kHz PCM audio as binary WebSocket frames
3. Server sends back:
   - JSON text frames: {"type": "transcript", "source_text": ..., "translated_text": ...}
   - Binary frames: raw 48kHz PCM audio to play
"""

import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.pipeline import TranslationPipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-translator")

app = FastAPI()

# Wide-open CORS for local dev / demo purposes. Tighten to specific
# origin (Vercel URL) before treating this as production-hardened.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """Simple liveness check - useful for Railway's health check probes."""
    return {"status": "ok"}


@app.websocket("/ws/translate")
async def translate_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    # Handshake: first message must be JSON specifying target language.
    try:
        handshake_raw = await websocket.receive_text()
        handshake = json.loads(handshake_raw)
        target_language = handshake["target_language"]
        pipeline = TranslationPipeline(target_language)
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        logger.warning("Bad handshake: %s", exc)
        await websocket.close(code=1003, reason="Invalid handshake")
        return

    logger.info("Session started, target_language=%s", target_language)

    try:
        while True:
            pcm_chunk = await websocket.receive_bytes()
            for result in pipeline.feed(pcm_chunk):
                if result["type"] == "transcript":
                    await websocket.send_text(json.dumps(result))
                elif result["type"] == "audio":
                    await websocket.send_bytes(result["data"])
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:
        logger.error("Pipeline error: %s", exc)
        await websocket.close(code=1011, reason="Internal error")