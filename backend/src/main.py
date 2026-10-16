"""Bounded, asynchronous WebSocket transport for the translation pipeline."""
import asyncio
from contextlib import suppress
import json
import logging
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from src.config import (ALLOWED_ORIGINS, LANGUAGES, SESSION_SECONDS,
                        SESSION_CHARACTERS, missing_configuration)
from src.limits import DemoLimit, DemoLimits
from src.pipeline import TranslationPipeline

logger = logging.getLogger('voice-translator')
app = FastAPI(title='Voice Translator', docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=['GET'], allow_headers=[])
limits = DemoLimits()


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.get('/ready')
async def ready():
    missing = missing_configuration()
    return JSONResponse({'status': 'unconfigured' if missing else 'ready',
                         'missing': missing, 'languages': list(LANGUAGES)},
                        status_code=503 if missing else 200)


def _next_result(iterator):
    # StopIteration cannot be transported through an asyncio Future.
    return next(iterator, None)


async def stream_results(iterator):
    """Advance lazy provider work off-loop; retain the slot until cancellation finishes."""
    try:
        while True:
            pending = asyncio.create_task(asyncio.to_thread(_next_result, iterator))
            try:
                item = await asyncio.shield(pending)
            except asyncio.CancelledError:
                with suppress(Exception):
                    await pending
                raise
            if item is None:
                break
            yield item
    finally:
        iterator.close()


def public_error(exc):
    if isinstance(exc, DemoLimit):
        return str(exc)
    status = getattr(exc, 'status_code', None)
    if status == 429:
        return 'The AI provider’s free quota is temporarily exhausted. Please try again later.'
    if status in (401, 403):
        return 'An AI provider could not authorize this request. The demo owner needs to check its configuration.'
    if status in (402, 404):
        return 'The selected AI model or voice is unavailable on this account. Please try again later.'
    return 'Translation could not finish. Please check your connection and try again.'


@app.websocket('/ws/translate')
async def translate_ws(ws: WebSocket):
    if ws.headers.get('origin', '').rstrip('/') not in ALLOWED_ORIGINS:
        await ws.close(code=1008, reason='Origin not allowed')
        return
    await ws.accept()
    acquired = False
    pipeline = None
    worker = None
    send_lock = asyncio.Lock()

    async def send(event):
        async with send_lock:
            async with asyncio.timeout(10):
                if event['type'] == 'audio':
                    await ws.send_bytes(event['data'])
                else:
                    await ws.send_json(event)

    try:
        limits.acquire(ws.client.host if ws.client else 'unknown')
        acquired = True
        async with asyncio.timeout(8):
            message = await ws.receive()
        raw = message.get('text', '')
        if len(raw) > 1024:
            raise ValueError('Handshake too large')
        handshake = json.loads(raw)
        if not isinstance(handshake, dict) or not isinstance(handshake.get('target_language'), str):
            raise ValueError('Invalid handshake')
        pipeline = TranslationPipeline(handshake['target_language'])
        if missing_configuration():
            raise DemoLimit('The translation server is not configured yet. Please try again later.')
        characters = 0

        def reserve_characters(count):
            nonlocal characters
            if characters + count > SESSION_CHARACTERS:
                raise DemoLimit('This session’s voice allowance is complete. Thank you for trying the demo.')
            limits.reserve_characters(count)
            characters += count

        pipeline.reserve_request = limits.reserve_request
        pipeline.reserve_characters = reserve_characters
        queue = asyncio.Queue(maxsize=2)

        async def process():
            while True:
                chunk = await queue.get()
                if chunk is None:
                    return
                async for result in stream_results(pipeline._run_cycle(chunk)):
                    await send(result)
                await send({'type': 'usage', 'characters': characters, 'limit': SESSION_CHARACTERS})
                await send({'type': 'status', 'stage': 'listening'})

        worker = asyncio.create_task(process())
        await send({'type': 'ready', 'sample_rate': 48000,
                    'session_seconds': SESSION_SECONDS, 'character_limit': SESSION_CHARACTERS})
        started = time.monotonic()
        received_bytes = 0

        def enqueue(chunks):
            for chunk in chunks:
                try:
                    queue.put_nowait(chunk)
                except asyncio.QueueFull:
                    raise DemoLimit('Speech arrived faster than it could be translated. Please pause between sentences.')

        async with asyncio.timeout(SESSION_SECONDS):
            while True:
                receive = asyncio.create_task(ws.receive())
                try:
                    done, _ = await asyncio.wait([receive, worker], return_when=asyncio.FIRST_COMPLETED)
                    if worker in done:
                        await worker
                        break
                    message = receive.result()
                finally:
                    if not receive.done():
                        receive.cancel()
                        with suppress(asyncio.CancelledError):
                            await receive
                if message['type'] == 'websocket.disconnect':
                    raise WebSocketDisconnect(message.get('code', 1000))
                if message.get('bytes') is not None:
                    pcm = message['bytes']
                    if not pcm or len(pcm) > 9600 or len(pcm) % 2:
                        raise ValueError('Invalid PCM packet')
                    received_bytes += len(pcm)
                    if received_bytes > 96000 * (time.monotonic() - started + 2):
                        raise DemoLimit('Audio arrived too quickly. Please restart your session.')
                    enqueue(pipeline.feed_audio(pcm))
                else:
                    text = message.get('text', '')
                    if len(text) > 1024:
                        raise ValueError('Control message too large')
                    control = json.loads(text)
                    if not isinstance(control, dict) or control.get('action') != 'stop':
                        raise ValueError('Unknown control message')
                    enqueue(pipeline.finalize_audio())
                    await queue.put(None)
                    await worker
                    await send({'type': 'stopped'})
                    await ws.close(code=1000)
                    return
    except WebSocketDisconnect:
        pass
    except (ValueError, TypeError, KeyError):
        with suppress(Exception):
            await send({'type': 'error', 'message': 'Invalid session message. Please reconnect.'})
            await ws.close(code=1003, reason='Invalid message')
    except TimeoutError:
        with suppress(Exception):
            await send({'type': 'info', 'message': 'The demo session has ended. Start a new session to continue.'})
            await ws.close(code=1000, reason='Session time limit')
    except Exception as exc:
        logger.warning('Session ended: %s (status=%s)', type(exc).__name__, getattr(exc, 'status_code', None))
        with suppress(Exception):
            await send({'type': 'error', 'message': public_error(exc)})
            await ws.close(code=1008 if isinstance(exc, DemoLimit) else 1011)
    finally:
        if pipeline:
            pipeline.cancelled.set()
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await worker
        if acquired:
            limits.release()
