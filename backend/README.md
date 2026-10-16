# Relay backend

[Project overview](../README.md) · [Architecture and protocol](../docs/ARCHITECTURE.md) · [Deployment](../docs/DEPLOYMENT.md)

Python 3.12 + FastAPI service for utterance-based speech translation. It accepts 48 kHz microphone PCM over WebSocket and runs **Groq Whisper → Groq translation → ElevenLabs streaming TTS**, with bounded queues, explicit turn cancellation, quota safeguards and process-local observability.

## Run locally

From this directory:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

Fill the ignored `.env` with your provider keys and a Free-compatible ElevenLabs voice. Keep it private; on Unix, use `chmod 600 .env`. The checked-in example contains every environment-selectable demo setting.

```bash
uvicorn src.main:app --reload --port 8000
```

The entry point is **`src.main:app`**, run from `backend`. Health: http://localhost:8000/health. Readiness: http://localhost:8000/ready. The frontend normally runs at http://localhost:3000.

## Configuration

| Variable | Default / requirement | Meaning |
| --- | --- | --- |
| `GROQ_API_KEY` | Required secret | Recognition and translation access |
| `ELEVENLABS_API_KEY` | Required secret | Voice synthesis access |
| `TTS_VOICE_ID` | Required | Voice accessible on the configured Free account |
| `MT_MODEL` | `openai/gpt-oss-20b` | Translation model |
| `TTS_MODEL` | `eleven_flash_v2_5` | Streaming synthesis model |
| `ALLOWED_ORIGINS` | localhost / 127.0.0.1 on port 3000 | Comma-separated exact frontend origins; no wildcard |
| `MAX_SESSIONS` | `2` | Maximum concurrent sessions |
| `SESSION_SECONDS` | `180` | Session lifetime, including final processing |
| `SESSION_CHARACTERS` | `600` | Reserved voice characters per session |
| `REQUESTS_PER_MINUTE` | `15` | Global utterance pipeline starts per minute |
| `DAILY_CHARACTERS` | `1000` | Reserved voice characters per UTC day, per process |

The deployed built-in Sarah voice is `EXAVITQu4vr4xnSDxMaL`; verify access on your own account. `eleven_multilingual_v2` is an environment-selectable synthesis alternative, not an automatic fallback. Seven languages are exposed. STT model, provider timeout, VAD constants and supported languages are source settings in [`src/config.py`](src/config.py), not additional environment overrides.

Never commit `.env` or expose keys in frontend variables. Presence checks do not establish provider authorization or remaining credit.

## Endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | HTTP 200 liveness: `{"status":"ok"}` |
| `GET /ready` | Configuration presence; HTTP 503 with missing variable names if incomplete |
| `GET /metrics` | Public aggregate counters, latency distributions, provider observations, capacity and sanitized errors; `Cache-Control: no-store` |
| `WS /ws/translate` | Origin-checked audio/control transport; protocol 2 for current frontend, protocol 1 compatibility |

Readiness and monitoring do not call external AI APIs. Metrics contain no transcripts, audio, credentials or visitor addresses. Detailed binary framing and JSON contracts are in the [protocol guide](../docs/ARCHITECTURE.md#websocket-protocol).

## Processing and safeguards

- VAD consumes 20 ms PCM frames; default endpoint wait is 600 ms, minimum detected speech is 300 ms, maximum buffer is eight seconds.
- Each session has one worker and at most two queued utterances. Synchronous provider work runs off the event loop.
- Explicit interruption replaces the turn pipeline and discards old queued/results data. Already-issued calls finish within their timeout; future stages check cancellation.
- Stop flushes final speech and drains accepted work. Cleanup retains the slot until outstanding threaded work finishes.
- Six session starts per visitor address per 15 minutes, PCM packet/pacing checks, request reservations and voice-text reservations constrain usage.
- In-memory limits/metrics reset on sleep, restart or deployment. They are single-instance demo safeguards, not durable billing or distributed abuse prevention.
- Structured JSON events report session/utterance identity, direction, timings and sanitized failure metadata without conversation content. Platform access logs are separate.

## Source modules

`main.py` owns transport and session lifecycle; `pipeline.py` owns utterance orchestration. `stt.py`, `mt.py` and `tts.py` wrap providers. `vad.py` and `audio_utils.py` handle detection/conversion. `limits.py` and `observability.py` implement safeguards and measurements.

The server creates no recording/transcript store. Providers receive audio/text for inference; their data policies apply.

## Verify and deploy

```bash
python -m unittest discover -s tests -v
```

Tests mock AI calls and spend no provider quota. See [testing](../docs/TESTING.md) for coverage and manual acceptance.

Production uses Render **Free**, root `backend`, Python 3.12.12, one Uvicorn worker and `/health` as its health check. [`render.yaml`](../render.yaml) records the service template. Read the [deployment guide](../docs/DEPLOYMENT.md) before reusing proxy-trust flags outside Render's managed ingress.
