"""Bounded, asynchronous WebSocket transport for the translation pipeline."""
import asyncio
from contextlib import suppress
import json
import logging
import time
import math
import struct
from dataclasses import dataclass
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from src.config import (ALLOWED_ORIGINS, LANGUAGES, SESSION_SECONDS,
                        SESSION_CHARACTERS, missing_configuration,
                        GROQ_API_KEY, ELEVENLABS_API_KEY, TTS_VOICE_ID,
                        STT_MODEL, MT_MODEL, TTS_MODEL)
from src.limits import DemoLimit, DemoLimits
from src.pipeline import TranslationPipeline
from src.observability import Monitor, event_log

logger = logging.getLogger('voice-translator')
app = FastAPI(title='Voice Translator', docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=['GET'], allow_headers=[])
limits = DemoLimits()
monitor = Monitor()


@dataclass
class Utterance:
    pcm: bytes
    pipeline: TranslationPipeline
    turn_id: int
    utterance_id: int
    source_language: str | None
    target_language: str
    enqueued_at: float
    last_speech_at: float
    speech_end_ms: float


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.get('/ready')
async def ready():
    missing = missing_configuration()
    return JSONResponse({'status': 'unconfigured' if missing else 'ready',
                         'missing': missing, 'languages': list(LANGUAGES)},
                        status_code=503 if missing else 200)


@app.get('/metrics')
async def metrics():
    return JSONResponse(monitor.snapshot(limits.snapshot(),
        {'stt': bool(GROQ_API_KEY), 'translation': bool(GROQ_API_KEY),
         'tts': bool(ELEVENLABS_API_KEY and TTS_VOICE_ID)},
        {'stt': STT_MODEL, 'translation': MT_MODEL, 'tts': TTS_MODEL}),
        headers={'Cache-Control': 'no-store'})


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
                while not pending.done():
                    try:
                        await asyncio.shield(pending)
                    except asyncio.CancelledError:
                        continue
                    except Exception:
                        break
                with suppress(Exception):
                    pending.result()
                raise
            if item is None:
                break
            yield item
    finally:
        iterator.close()


async def finish_processing(queue, worker, final_chunks):
    """Drain accepted speech on Stop without hiding a failed provider behind a full queue."""
    for item in [*final_chunks, None]:
        pending = asyncio.create_task(queue.put(item))
        try:
            done, _ = await asyncio.wait([pending, worker], return_when=asyncio.FIRST_COMPLETED)
            if worker in done:
                await worker
                return
            await pending
        finally:
            if not pending.done():
                pending.cancel()
                with suppress(asyncio.CancelledError):
                    await pending
    await worker


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
    protocol = 1
    current_turn = 0
    utterance_number = 0
    session_id = uuid4().hex[:12]
    session_started = False
    send_lock = asyncio.Lock()

    async def send(event):
        async with send_lock:
            if protocol == 2 and event.get('turn_id', current_turn) != current_turn:
                return
            async with asyncio.timeout(10):
                if event['type'] == 'audio':
                    header = struct.pack('!II', event['turn_id'], event['utterance_id']) if protocol == 2 else b''
                    await ws.send_bytes(header + event['data'])
                    monitor.counts['audio_bytes_sent'] += len(event['data'])
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
        protocol = handshake.get('protocol', 1)
        if type(protocol) is not int or protocol not in (1, 2):
            raise ValueError('Unsupported protocol')
        source_language = handshake.get('source_language')
        target_language = handshake['target_language']
        pipeline = TranslationPipeline(target_language, source_language)
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
                job = await queue.get()
                if job is None:
                    return
                if job.pipeline.cancelled.is_set():
                    monitor.increment('utterances_interrupted')
                    continue
                monitor.increment('utterances_started')
                began = time.perf_counter()
                timings = {'queue_ms': round((began-job.enqueued_at)*1000, 2),
                           'endpoint_ms': round((job.enqueued_at-job.last_speech_at)*1000, 2)}
                stage = 'stt'
                audio_bytes = 0
                tags = {'turn_id': job.turn_id, 'utterance_id': job.utterance_id,
                        'source_language': job.source_language, 'target_language': job.target_language}
                try:
                    async for result in stream_results(job.pipeline._run_cycle(job.pcm)):
                        if job.pipeline.cancelled.is_set():
                            continue
                        if result['type'] == 'status':
                            stage = {'transcribing':'stt', 'translating':'translation', 'speaking':'tts'}[result['stage']]
                        if result['type'] == 'timing':
                            timings[result['stage']+'_ms'] = result['duration_ms']
                            monitor.stage_success(result['stage'], result['duration_ms'])
                            continue
                        if result['type'] == 'audio':
                            if not audio_bytes:
                                timings['speech_to_first_audio_ms'] = round((time.perf_counter()-job.last_speech_at)*1000, 2)
                                await send({'type':'metrics', 'timings':dict(timings), **tags})
                            audio_bytes += len(result['data'])
                        await send({**result, **tags})
                except asyncio.CancelledError:
                    monitor.increment('utterances_interrupted')
                    event_log('utterance_interrupted', session_id=session_id, **tags)
                    raise
                except Exception as exc:
                    if not job.pipeline.cancelled.is_set():
                        monitor.increment('utterances_failed')
                        if not isinstance(exc, DemoLimit):
                            monitor.stage_error(stage, exc)
                        event_log('utterance_failed', session_id=session_id, **tags,
                                  stage=stage, error_type=type(exc).__name__, status_code=getattr(exc,'status_code',None))
                        raise
                if job.pipeline.cancelled.is_set():
                    monitor.increment('utterances_interrupted')
                    event_log('utterance_interrupted', session_id=session_id, **tags)
                    continue
                monitor.increment('utterances_completed' if audio_bytes else 'utterances_empty')
                for name in ['queue_ms','endpoint_ms','speech_to_first_audio_ms']:
                    if name in timings:
                        monitor.observe(name, timings[name])
                event_log('utterance_complete', session_id=session_id, **tags,
                          timings=timings, audio_bytes=audio_bytes)
                await send({'type': 'usage', 'characters': characters, 'limit': SESSION_CHARACTERS, **tags})
                await send({'type': 'status', 'stage': 'listening', **tags})

        worker = asyncio.create_task(process())
        await send({'type': 'ready', 'sample_rate': 48000,
                    'session_seconds': SESSION_SECONDS, 'character_limit': SESSION_CHARACTERS,
                    'protocol': protocol, 'turn_id': 0, 'session_id': session_id,
                    'source_language': source_language, 'target_language': target_language})
        session_started = True
        monitor.increment('sessions_started')
        event_log('session_started', session_id=session_id, protocol=protocol)
        started = time.monotonic()
        received_bytes = 0

        def jobs_for(chunks, speech_end_ms):
            nonlocal utterance_number
            jobs = []
            for chunk in chunks:
                utterance_number += 1
                now = time.perf_counter()
                jobs.append(Utterance(chunk, pipeline, current_turn, utterance_number,
                    source_language, target_language, now, pipeline.last_speech_at or now, speech_end_ms))
            return jobs

        async def announce(job):
            if protocol == 2:
                await send({'type':'utterance', 'turn_id':job.turn_id, 'utterance_id':job.utterance_id,
                            'source_language':job.source_language, 'target_language':job.target_language,
                            'speech_end_ms':job.speech_end_ms})

        async def enqueue(chunks, speech_end_ms):
            for job in jobs_for(chunks, speech_end_ms):
                try:
                    queue.put_nowait(job)
                except asyncio.QueueFull:
                    raise DemoLimit('Speech arrived faster than it could be translated. Please pause between sentences.')
                await announce(job)

        last_client_speech_end = 0.0
        last_control_at = 0.0

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
                    if protocol == 2:
                        if len(pcm) <= 12:
                            raise ValueError('Missing PCM header')
                        packet_turn, client_speech_end = struct.unpack('!Id', pcm[:12])
                        if not math.isfinite(client_speech_end) or client_speech_end < 0:
                            raise ValueError('Invalid audio timestamp')
                        if packet_turn != current_turn:
                            if packet_turn < current_turn:
                                continue
                            raise ValueError('Unknown turn')
                        last_client_speech_end = client_speech_end
                        pcm = pcm[12:]
                    if not pcm or len(pcm) > 9600 or len(pcm) % 2:
                        raise ValueError('Invalid PCM packet')
                    received_bytes += len(pcm)
                    if received_bytes > 96000 * (time.monotonic() - started + 2):
                        raise DemoLimit('Audio arrived too quickly. Please restart your session.')
                    await enqueue(pipeline.feed_audio(pcm), last_client_speech_end)
                else:
                    text = message.get('text', '')
                    if len(text) > 1024:
                        raise ValueError('Control message too large')
                    control = json.loads(text)
                    if not isinstance(control, dict):
                        raise ValueError('Unknown control message')
                    if control.get('action') == 'interrupt' and protocol == 2:
                        if type(control.get('turn_id')) is not int or control['turn_id'] != current_turn+1:
                            raise ValueError('Invalid turn sequence')
                        if time.monotonic()-last_control_at < .25:
                            raise DemoLimit('Please allow the new speaker turn to connect before switching again.')
                        new_source, new_target = control.get('source_language'), control.get('target_language')
                        replacement = TranslationPipeline(new_target, new_source)
                        replacement.reserve_request = limits.reserve_request
                        replacement.reserve_characters = reserve_characters
                        pipeline.cancelled.set()
                        while not queue.empty():
                            queue.get_nowait()
                            monitor.increment('utterances_interrupted')
                        pipeline = replacement
                        source_language, target_language = new_source, new_target
                        current_turn += 1
                        last_client_speech_end = 0.0
                        last_control_at = time.monotonic()
                        monitor.increment('interruptions')
                        await send({'type':'turn_ready', 'turn_id':current_turn,
                                    'source_language':source_language, 'target_language':target_language})
                        event_log('turn_changed', session_id=session_id, turn_id=current_turn)
                        continue
                    if control.get('action') != 'stop':
                        raise ValueError('Unknown control message')
                    final_jobs = jobs_for(pipeline.finalize_audio(), last_client_speech_end)
                    for job in final_jobs:
                        await announce(job)
                    await finish_processing(queue, worker, final_jobs)
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
        if not session_started:
            monitor.increment('sessions_rejected')
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
        if session_started:
            monitor.increment('sessions_ended')
            event_log('session_ended', session_id=session_id)
