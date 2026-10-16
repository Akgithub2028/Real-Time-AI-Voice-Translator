# Deployment and operations

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md) · [Recorded verification](PRODUCTION_VERIFICATION.md)

The non-commercial demo runs on **Vercel Hobby + Render Free + Groq Free + ElevenLabs Free**. No database, paid monitoring service or keep-alive bot is required. Free-tier configuration was verified on 2026-10-16; provider availability and workspace allowances can change.

## Public resources

| Resource | Address / configuration |
| --- | --- |
| Translator | [▶ Launch translator](https://real-time-ai-voice-translator.vercel.app) |
| Live dashboard | [▶ View system status](https://real-time-ai-voice-translator.vercel.app/status) |
| Backend | `https://voice-translator-backend-u725.onrender.com` |
| Liveness | [GET /health](https://voice-translator-backend-u725.onrender.com/health) |
| Configuration readiness | [GET /ready](https://voice-translator-backend-u725.onrender.com/ready) |
| Aggregate observations | [GET /metrics](https://voice-translator-backend-u725.onrender.com/metrics) |
| WebSocket | `wss://voice-translator-backend-u725.onrender.com/ws/translate` |

## Vercel frontend

Import the repository as a **single Next.js frontend project**, using the Hobby plan:

| Setting | Value |
| --- | --- |
| Project | `real-time-ai-voice-translator` |
| Root directory | `frontend` |
| Framework | Next.js |
| Production branch | `main` |
| Build | Standard Next.js build (`npm run build`) |

Configure this public, non-secret environment variable for the appropriate deployment environments:

```dotenv
NEXT_PUBLIC_WS_URL=wss://voice-translator-backend-u725.onrender.com/ws/translate
```

It is embedded in the browser bundle at build time. Changing it requires a new build. Never put Groq/ElevenLabs keys in Vercel frontend variables. Production HTTPS requires `wss://`; a `ws://` URL will be rejected as mixed content.

The dashboard uses the same backend origin to fetch health, readiness and metrics. Vercel does not host the persistent translation WebSocket server.

## Render backend

Create or maintain a Python **Web Service** on the **Free** instance plan. [`render.yaml`](../render.yaml) records the service template; secret values must be configured separately.

| Setting | Value |
| --- | --- |
| Service | `voice-translator-backend` |
| Region | Singapore |
| Root directory | `backend` |
| Python version | `3.12.12` via `PYTHON_VERSION` |
| Build | `pip install -r requirements.txt` |
| Health-check path | `/health` |
| Uvicorn workers | `1` |

Start command for Render's managed ingress:

```bash
uvicorn src.main:app --host 0.0.0.0 --port $PORT --workers 1 --ws-max-size 16384 --ws-max-queue 16 --proxy-headers --forwarded-allow-ips '*'
```

One worker keeps the in-memory global capacity, budgets and metrics consistent for this single-instance demo. The proxy flags let Uvicorn consume client metadata from Render's managed ingress so per-visitor limits do not collapse onto a shared proxy address. Do not reuse wildcard proxy trust when exposing Uvicorn directly; trust only the known proxy in another deployment environment.

### Server environment

| Variable | Setting |
| --- | --- |
| `GROQ_API_KEY` | Secret, stored in Render only and an optional ignored local `.env` |
| `ELEVENLABS_API_KEY` | Secret, same handling |
| `TTS_VOICE_ID` | Free-compatible built-in voice; verified Sarah ID: `EXAVITQu4vr4xnSDxMaL` |
| `MT_MODEL` | `openai/gpt-oss-20b` |
| `TTS_MODEL` | `eleven_flash_v2_5` |
| `PYTHON_VERSION` | `3.12.12` |
| `ALLOWED_ORIGINS` | Exact frontend origins, comma-separated |

Example production allowlist:

```dotenv
ALLOWED_ORIGINS=https://real-time-ai-voice-translator.vercel.app,https://real-time-ai-voice-translator-akgithub2028s-projects.vercel.app
```

Local origins may also be explicitly allowed for development. Preview URLs require their own exact entry; wildcard origins are not used. A configured frontend variable does not automatically authorize a preview origin on the backend.

Optional environment overrides and defaults:

```dotenv
MAX_SESSIONS=2
SESSION_SECONDS=180
SESSION_CHARACTERS=600
REQUESTS_PER_MINUTE=15
DAILY_CHARACTERS=1000
```

`eleven_multilingual_v2` remains an optional `TTS_MODEL` alternative. The current seven-language menu works with the deployed Flash model. Verify model/voice availability in the account before changing either. The earlier Llama configuration and a professional library voice were unavailable on this account; the deployed free alternatives succeeded in real API tests. Adding a library voice to a collection does not guarantee Free API access.

Keep production credentials server-side, never in source, shell output, issues or screenshots. For rotation, replace the key in its provider dashboard, update Render's secret environment value and redeploy; update your ignored local `.env` separately. Restrict local file access, for example with `chmod 600 backend/.env` on Unix.

## Release and recovery checks

1. Run the checks appropriate to the changed code in [TESTING.md](TESTING.md). Confirm no secrets or private notes are staged.
2. Push the verified revision through the repository's normal Git flow. Inspect the connected Vercel/Render deployment status and confirm the intended commit is Ready/live; a successful local build alone is insufficient.
3. Confirm `/health` returns `{"status":"ok"}`, `/ready` returns HTTP 200, and `/metrics` returns aggregate JSON with `Cache-Control: no-store`.
4. Open the public translator and run a short bidirectional acceptance within remaining free quotas. Confirm captions, audio, speaker switch, Stop, replay and released capacity.
5. Check the dashboard and sanitized Render events. Configuration readiness is not proof of upstream authorization, available credits or successful synthesis.

If a revision fails, inspect build/runtime logs and roll back through the hosting platform to a known working deployment. Keep frontend protocol 2 and backend support aligned; backend protocol 1 compatibility permits older frontend sessions during staged rollouts. Avoid retry loops that repeatedly consume provider quota.

## Health and observability

| Signal | What it establishes |
| --- | --- |
| `/health` | HTTP process liveness |
| `/ready` | Required variables are present; HTTP 503 identifies missing variable names |
| `/metrics` | Actual process counters, recent durations, capacity and observed stage outcomes |
| Dashboard | Visible-page checks and presentation of those real observations |
| Render JSON events | Session/utterance direction, durations and sanitized failure metadata |

The dashboard polls every 15 seconds only while visible. Hidden pages pause checks; failed/stale readings are labelled. Provider state distinguishes unconfigured, unobserved, success observed and error observed; no synthetic AI health requests are made.

Metrics retain the latest 120 durations per metric and 20 sanitized provider errors. They reset on process restart, sleep or redeploy. Success rate uses completed and failed utterances, excluding empty/interrupted work. The displayed voice budget counts reserved text, even when later synthesis fails or is interrupted. It is not the provider's monthly balance.

Application events omit transcripts, recordings, keys and visitor addresses. Platform access logs are separate. The app stores no server-side conversations; providers process inference inputs under their own policies. Browser captions/replay remain in memory only.

## Operating within free tiers

The demo enforces:

- Two concurrent sessions and a 180-second capture/processing budget per session. Cleanup of an in-flight provider call can continue until its timeout.
- 600 reserved synthesis characters per session and 1,000 per UTC day across the process.
- 15 utterance pipeline starts per minute globally and six session starts per visitor address per 15 minutes.
- Two queued utterances per session, bounded packet size, input pacing and finite provider timeouts.

These process-local controls reset on restart and are not a durable monthly usage ledger or distributed abuse prevention. Provider Free quotas remain authoritative. There is no paid fallback, automatic credit purchase or usage extension enabled by application code.

Render Free sleeps after inactivity and can take about a minute to wake. The frontend checks readiness before requesting the microphone, displays a wake-up state, and waits up to 90 seconds. Normal disconnect/restart recovery is an explicit new session; old microphone data is not automatically replayed. Monitoring is not an always-on uptime service and no keep-alive bot is configured.

Render's included instance hours are shared across Free services in the workspace; bandwidth/build allowances also apply. A Free compute plan does not itself disable separate workspace overage billing. For strict zero-spend operation, retain capped billing settings or no payment method, monitor included allowances, and never enable paid upgrades or credit extension. ElevenLabs was verified as `free` with paid extension disabled. Vercel metadata reported `hobby`, and Render reported `free`. This demo's Free voice output is non-commercial and attributed to `elevenlabs.io` in the UI.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| Render build tries npm commands | Root must be `backend`, runtime Python, build command pip |
| Health works but readiness is 503 | Configure the missing server variables; no key values are returned |
| WebSocket rejected | Exact browser origin in `ALLOWED_ORIGINS`, HTTPS→WSS, correct endpoint path |
| Slow first connection | Allow free-service wake-up; distinguish connection timing from pipeline latency |
| Provider 401/403 | Verify/rotate server credentials and provider permissions |
| Provider 402/404 | Verify account access to the selected free model/voice; do not enable a paid fallback |
| Provider 429 / demo budget reached | Wait for the relevant limit reset and inspect provider usage; avoid repeated retries |
| No first words after a switch | Use explicit controls and headphones; inspect acknowledgement/queue timing; do not assume automatic acoustic interruption |
| Dashboard has no samples | A new process may not have completed real speech yet; configured is distinct from observed |
| Counters reset | Expected after sleep, restart or deployment; there is no durable metrics store |

## Primary service documentation

- [Render Free behavior and workspace limits](https://render.com/docs/free)
- [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Groq models](https://console.groq.com/docs/models) and [request limits](https://console.groq.com/docs/rate-limits)
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models) and [Free publishing/attribution](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
