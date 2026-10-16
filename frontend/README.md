# Relay frontend

[▶ Live translator](https://real-time-ai-voice-translator.vercel.app) · [▶ Live dashboard](https://real-time-ai-voice-translator.vercel.app/status) · [Project overview](../README.md)

Next.js 16.4.2, React 19 and TypeScript frontend for two-way voice translation. It captures microphone PCM, exchanges turn-tagged events with FastAPI, schedules synthesized audio with Web Audio, and displays real system metrics. There are no AI credentials in this application.

## Run locally

Use Node.js **20.9+**, npm, and the [backend](../backend/README.md) on port 8000. From this directory:

```bash
npm ci
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000. The example contains:

```dotenv
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/translate
```

This value is public and embedded at build time. Use `wss://` for an HTTPS deployment and rebuild after changing it. Never add Groq or ElevenLabs keys to `NEXT_PUBLIC_*` variables. Ensure the backend's `ALLOWED_ORIGINS` includes the exact frontend origin.

Production build:

```bash
npm run build
npm run start
```

## Routes and controls

| Route | Purpose |
| --- | --- |
| `/` | Language selection, microphone, waveform, bilingual captions, playback, replay and turn timings |
| `/status` | Backend liveness/configuration, provider observations, latency distributions, outcomes and demo budgets |

Choose source and target before starting. **Switch speaker** swaps languages while preserving the connection; **Interrupt & speak** stops old playback and starts a turn in the current direction. Stop releases the microphone while final accepted translation work drains. Received captions/audio remain available for copying/replay. Use headphones; normal microphone forwarding is gated during translated playback.

Connection/wake-up, microphone permission, speaker acknowledgement, translation, playback, limits and errors have distinct UI states. A disconnected session is restarted manually rather than replaying old captured speech.

## Source map

| File | Responsibility |
| --- | --- |
| [`app/page.tsx`](app/page.tsx) | Main translator view and controls |
| [`hooks/use-translator.ts`](hooks/use-translator.ts) | Audio/socket lifecycle, turn guards, bounded pre-roll, replay and cleanup |
| [`public/pcm-processor.js`](public/pcm-processor.js) | Off-main-thread Float32→PCM16 conversion and 20 ms framing |
| [`app/status/page.tsx`](app/status/page.tsx) | Real health/ready/metrics polling and stale/error handling |
| [`app/globals.css`](app/globals.css) | Shared light theme, responsive layouts, focus and motion behavior |
| [`tests`](tests) | Worklet and Chrome integration regressions |

Protocol 2 includes turn/utterance IDs on binary output as well as JSON, allowing stale audio to be discarded before playback. Capture starts after server acceptance. Generation guards prevent late permission or replay promises from reviving ended sessions. History is capped at 20 conversation rows in browser memory.

## Dashboard behavior

The dashboard derives HTTP endpoint origins from the configured WebSocket URL. It reads `/health`, `/ready`, and `/metrics` every 15 seconds while visible; hidden pages pause checks. Failures and readings older than 45 seconds are labelled. Provider configuration is distinguished from actual success/error observations. No polling call spends AI quota, and no monitoring vendor or database is needed.

Browser speech-end→scheduled-playback timing is separate from server pipeline latency and cold-start connection time. It measures the Web Audio schedule, not actual speaker hardware onset. See the [architecture guide](../docs/ARCHITECTURE.md#measurement-semantics).

## Checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

For browser checks, install Google Chrome; the suite launches Playwright with `channel: "chrome"`. Start the production build on port 3100:

```bash
npm run start -- --hostname 127.0.0.1 --port 3100
```

In another terminal in this directory:

```bash
npm run test:browser
```

Browser tests use a synthetic microphone and intercepted provider responses, so they do not consume AI quota. `TEST_BASE_URL` selects another frontend; `SCREENSHOT_DIR` optionally saves responsive screenshots. See [testing](../docs/TESTING.md) for coverage and real-provider acceptance steps.

## Deploy

Vercel Hobby uses root directory `frontend`, the Next.js preset, and the production `NEXT_PUBLIC_WS_URL`. The backend is deployed separately on Render Free. Exact production and authorized preview origins must be allowed by the backend. Full settings: [deployment and operations](../docs/DEPLOYMENT.md).
