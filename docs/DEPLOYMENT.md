# Relay deployment and operations

The owner authorized automatic deployment on 2026-10-16. README files are intentionally unchanged.

## Deployed architecture

Browser microphone → 20 ms, 48 kHz mono PCM over secure WebSocket → FastAPI on Render Free → Groq `whisper-large-v3-turbo` → Groq `openai/gpt-oss-20b` → ElevenLabs `eleven_multilingual_v2` → streamed PCM playback and bilingual captions.

Translation happens per utterance, after a pause or an eight-second speech boundary. It is not simultaneous word-by-word interpretation. Audio and captions remain in browser memory; the application stores no recordings or conversations on its server. Providers process the audio/text according to their own policies.

The original Llama 3.3 model returned HTTP 404 for this account; the supplied professional library voice returned HTTP 402 requiring payment. The owner explicitly approved a supported free-model/voice fallback. Groq GPT-OSS 20B and the built-in ElevenLabs Sarah voice were verified with live successful API calls. No paid account upgrade was enabled. Supported translation targets: English, Hindi, Tamil, Spanish, French, German and Japanese. Telugu is omitted because Multilingual v2 does not support its synthesis.

## Production resources

| Resource | Configuration |
| --- | --- |
| Frontend | https://real-time-ai-voice-translator.vercel.app |
| Vercel project | `real-time-ai-voice-translator`, scope `akgithub2028s-projects`, Hobby |
| Frontend root | `frontend`, Next.js preset, automatic builds from `main` |
| Backend | https://voice-translator-backend-u725.onrender.com |
| Liveness | https://voice-translator-backend-u725.onrender.com/health |
| Configuration readiness | https://voice-translator-backend-u725.onrender.com/ready |
| WebSocket | `wss://voice-translator-backend-u725.onrender.com/ws/translate` |
| Render service | `voice-translator-backend`, `srv-db8nc6nf3r2c73en9dag`, Singapore, Free |
| Backend root | `backend`, Python 3.12.12, one Uvicorn worker |
| Build | `pip install -r requirements.txt` |
| Start | `uvicorn src.main:app --host 0.0.0.0 --port $PORT --workers 1 --ws-max-size 16384 --ws-max-queue 16` |

The initial Render failure came from Node commands (`npm run build`, `npm install`) configured on the Python service with no backend root. Those settings were repaired through the authenticated API and verified by successful production deployment.

`/health` reports liveness. `/ready` verifies required variables are present; it does not spend API quota or claim the upstream providers are reachable. Missing configuration returns HTTP 503 and variable names only.

## Environment configuration

Render server-side variables:

- `GROQ_API_KEY`, `ELEVENLABS_API_KEY`: secrets stored only in the service environment and an optional ignored local backend `.env`.
- `TTS_VOICE_ID`: a compatible built-in voice; current Sarah ID `EXAVITQu4vr4xnSDxMaL`.
- `MT_MODEL=openai/gpt-oss-20b`.
- `PYTHON_VERSION=3.12.12`.
- `ALLOWED_ORIGINS`: exact production Vercel origins and local development origins, comma separated. No wildcard. Preview deployments need their exact origin added explicitly if they should access the backend.

Vercel's public, non-secret variable:

```env
NEXT_PUBLIC_WS_URL=wss://voice-translator-backend-u725.onrender.com/ws/translate
```

It is configured for production, preview and development; production origin checks still apply. Public variables are embedded at build time, so changing this value requires redeployment. Keep AI keys out of Vercel frontend variables and browser code.

The local `backend/.env` was created from the configured service secrets with file mode `0600`; it is gitignored and was never staged. It uses the verified free model/voice and permits localhost development on ports 3000 and 3100. The frontend's default local connection is `ws://localhost:8000/ws/translate`.

Credentials shared in conversation must be revoked and replaced through the respective provider dashboards. Never copy keys into source, issue descriptions, logs or deployment documentation. Update Render's secret environment variables and redeploy after rotation.

## Free-tier safeguards and limits

- Two concurrent sessions; maximum 180 seconds each, including final processing.
- Maximum 600 synthesized characters per session and 1,000 per UTC day across the running process.
- Maximum 15 utterance pipeline requests per minute across sessions, plus six session starts per client address per 15 minutes.
- At most two queued utterances per session, bounded packet size and input pacing. Slow networks and overloaded queues receive clear errors.
- Provider work runs off the event loop. Disconnects cancel future provider stages, wait for the current finite-timeout call, and release capacity. A Stop flush drains accepted speech before acknowledging.
- Provider credit failures remain server-side and return sanitized messages. Provider clients use finite timeouts; no paid fallback is used.
- Microphone access begins after server readiness/handshake. Cancellation, failure and Stop release tracks; final audio can finish playing. Input is suppressed during playback to reduce feedback. Headphones are still recommended.
- History is capped at 20 caption pairs in browser memory. Replay and copying text do not call providers.

Counters are intentionally in memory: they reset on restart, sleep or redeployment. They are demo safeguards, not a durable monthly accounting system or distributed abuse prevention. Provider Free credit limits remain authoritative. Render's 750 instance hours are shared across this workspace's Free services. Cold starts can take about a minute; the frontend waits up to 90 seconds with a wake-up message. No artificial keep-alive service is configured.

Plans verified: Vercel deployment metadata reports Hobby; Render service reports Free; ElevenLabs subscription reports `free`, 10,000 credits and `can_extend_character_limit=false`. No paid resource, credit purchase, disk or database was added. Do not enable usage billing or attach paid upgrades. Render's included bandwidth/build allowances also apply; existing workspace billing settings are separate from the instance type and must remain capped or without a payment method for strict zero-spend operation.

## Verification commands

Backend (from `backend`, with requirements installed):

```sh
python -m unittest discover -s tests -v
```

Frontend (from `frontend`):

```sh
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
```

In another terminal, with Google Chrome installed:

```sh
npm run test:browser
```

`TEST_BASE_URL` can select a different local URL. Browser tests intercept the backend and do not spend provider quota. They exercise actual microphone/worklet/Web Audio resources with Chrome's synthetic microphone. `SCREENSHOT_DIR` optionally saves desktop and mobile screenshots.

The test client emits a Starlette/httpx deprecation warning; tests still pass. Production dependency audit is clean (`npm audit --omit=dev`). The full audit retains five development-only high findings in the ESLint plugin's `fast-glob`/`micromatch`/`braces` chain; there is no available compatible patch. Do not use `npm audit fix --force`, whose proposed downgrade would break the matching Next.js lint configuration.

## Current primary sources

- [Render Free behavior and workspace quotas](https://render.com/docs/free)
- [Render FastAPI configuration](https://render.com/docs/deploy-fastapi)
- [Groq free request limits](https://console.groq.com/docs/rate-limits)
- [Groq current models](https://console.groq.com/docs/models)
- [ElevenLabs supported models and languages](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs Free publishing and attribution requirements](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)

This is a non-commercial portfolio demo. The page title and footer include `elevenlabs.io` attribution. Provider offerings can change; repeat the model and voice compatibility checks before future migrations.
