# Production verification — 2026-10-16

## Current public deployment

- Translator: https://real-time-ai-voice-translator.vercel.app
- Live dashboard: https://real-time-ai-voice-translator.vercel.app/status
- Health: https://voice-translator-backend-u725.onrender.com/health
- Readiness: https://voice-translator-backend-u725.onrender.com/ready
- Aggregate metrics: https://voice-translator-backend-u725.onrender.com/metrics

Vercel production deployment `dpl_32zRpX8zhYLs29f6kAA2GToecEU5` reports Ready, Hobby and commit `1c2738b`. Render deployment `dep-db8ooglbq1ds73de6cg0` reports live on backend commit `36f7891`, with the Free instance plan and configured Flash model.

Architecture: browser AudioWorklet → 48 kHz PCM over WSS → FastAPI → Groq Whisper Large v3 Turbo → Groq GPT-OSS 20B → ElevenLabs Flash v2.5 streaming endpoint → tagged PCM/Web Audio playback. The verified free translation model and built-in voice remain in use.

## Real bidirectional acceptance

Chrome loaded the public frontend. A synthetic Web Audio microphone fed an English WAV through the application's actual capture worklet. The full real Hindi synthesis from that turn was then fed back through the microphone for a Hindi→English turn. No WebSocket, backend or AI response was mocked in this acceptance run. The test used one session and one WebSocket throughout.

1. English input and actual STT: “Hello, how are you today? It is nice to meet you.”
2. Actual Hindi translation: “नमस्ते, आप आज कैसे हैं? आपसे मिलकर खुशी हुई।”
3. Hindi synthesized output: 320,992 bytes of 48 kHz PCM received.
4. **Switch speaker** immediately stopped scheduled playback and changed English→Hindi to Hindi→English on the same connection, retaining the earlier captions.
5. Actual Hindi STT: “नमस्ते, आप आज कैसे हैं? आपसे मिलकर खुशी हुई.”
6. Actual English translation: “Hello, how are you today? Nice to meet you.”
7. English synthesized output: 213,996 PCM bytes received.
8. Stop acknowledged, all acquired microphone tracks ended, and replay scheduled successfully without another provider request. Playback AudioContexts were running and no browser JavaScript errors occurred.
9. The real dashboard reported all three provider stages as success observed. Health, readiness and metrics returned HTTP 200 with the exact production CORS origin; metrics returned `Cache-Control: no-store`. Capacity returned to zero active sessions.

### Observed latency, milliseconds

| Measurement | English→Hindi | Hindi→English |
| --- | ---: | ---: |
| Endpoint wait, server clock | 598.53 | 553.50 |
| Queue wait | 0.24 | 0.25 |
| Groq STT | 327.25 | 289.09 |
| Groq translation | 464.84 | 521.68 |
| ElevenLabs first byte | 116.97 | 114.47 |
| Last speech received → first audio, server | 1,510.03 | 1,490.14 |
| Speech end → scheduled playback, browser | 1,657 | 1,680 |

These are two warm observations, not a benchmark or latency guarantee. An earlier public session measured 3,492.69 and 1,369.16 ms on the server, including a 1,935.04 ms STT call on the first turn. Endpointing retains the fixed 600 ms pause policy; packet batching and receipt timing can change its measured server wait. Network, free-provider and cold-start variance remain visible rather than hidden.

Browser scheduled playback uses the browser's own monotonic clock plus the Web Audio schedule. It includes transport but is not a physical speaker-onset measurement. Server timings use a separate monotonic clock and exclude browser transport. Cold-start connection time is separate. These checks establish capture/transport/provider output and playback scheduling; they do not establish subjective listening quality, physical microphone coverage, automatic acoustic barge-in or exhaustive language accuracy.

## Local acceptance

The same English→Hindi→English flow passed at `http://127.0.0.1:3100` with `ws://localhost:8000/ws/translate`, real free APIs, one connection, successful interruption/replay, microphone cleanup and no browser errors. Server first-audio observations were 2,542.37 and 1,713.14 ms; output sizes were 263,036 and 200,620 PCM bytes. The ignored local backend environment has private `0600` permissions.

## Automated checks

| Check | Result |
| --- | --- |
| Backend unittest suite | 27 passed |
| AudioWorklet frame buffering and tail flush | 2 passed |
| Chrome browser regressions, local and deployed frontend | 9 passed each |
| ESLint | No issues |
| TypeScript and Next.js production build | Passed |
| axe WCAG 2/2.1 A/AA, translator and dashboard, 1440/390 px, local and public | Zero violations |
| Layout checks at 320/390/1440 px | No page overflow |
| Production npm audit | Zero vulnerabilities |
| Public health/readiness/metrics and CORS | Passed |
| Tracked source and built static JavaScript secret scan | No configured credential matches in 66 files |

Backend regressions cover protocol 1 compatibility, final Stop draining, full-queue/provider failures, streamed sample alignment, explicit source language, protocol 2 audio tagging, same-socket direction changes, immediate interruption acknowledgement during a blocked provider, cancellation before subsequent provider calls, slot cleanup, latency retention/percentiles and sanitized aggregate/provider observations.

Browser regressions cover language swapping, immediate playback stop and rejection of stale old-turn audio, acknowledgement buffering/pre-roll and Stop racing a switch, retained captions/replay, framing, microphone release, denied/pending permission, cold-start cancellation, delayed replay invalidation, measured dashboard values and failed refresh states. Mocked browser/backend unit checks do not spend provider quota.

Independent code review found a cancellation boundary where an interrupted generator could still start its next provider call; checks and regression were added. A frontend cooldown now matches server switch pacing. The dashboard's horizontally scrollable latency table was made keyboard focusable after its mobile accessibility scan.

## Milestone commits

- `8a81504` — stabilize sessions and configure Render Free.
- `ba63199` — supported free Groq translation model.
- `2e4a8ea` — propagate provider failures while draining final speech.
- `1a837ce` — polished Relay UI, audio lifecycle, browser/worklet tests and patched dependencies.
- `30cca99` — baseline deployment verification and operations documentation.
- `36f7891` — streaming voice, explicit turn protocol and measured backend monitoring.
- `1c2738b` — two-way controls, immediate playback interruption and live status dashboard.

## Free-tier status and practical limits

Vercel metadata reports `hobby`; Render service reports `free`. ElevenLabs subscription reports `free`, 10,000 included credits and `can_extend_character_limit=false`; successful live Flash requests establish account compatibility. Groq's configured STT/translation models are available to the account and used through its Free allowance. No paid resource, subscription upgrade, credit purchase, database, monitoring vendor or keep-alive bot was enabled. Render's included hours/bandwidth/build allowances remain shared workspace limits; Free compute does not override separate workspace billing settings.

The dashboard displays actual process observations, sample counts and failed/stale checks. It does not fabricate traffic or claim a historical uptime SLA. Metrics reset on sleep/restart/deploy; the latest 120 latency samples and 20 sanitized provider errors are retained. Voice budgets are process-local reserved text counts, not the provider's monthly balance. Structured session/utterance logs use existing Render logging and contain no user content or visitor addresses.

The demo remains utterance-based with controlled manual interruption, normal input gating during playback, headphones recommended, two concurrent sessions, three minutes and 600 synthesis characters per session, 1,000 daily process characters and 15 pipeline requests/minute. In-flight synchronous requests finish within their provider timeout before the worker advances; stale output is discarded. Adaptive endpointing and automatic full-duplex acoustic separation were not introduced.

Render Free may take about a minute to wake and may restart. Seven languages are offered. Five upstream development-only npm high advisories remain in the ESLint glob chain without a compatible fix; production dependencies are clean. ElevenLabs Free output is non-commercial and attributed in the UI.

## Documentation validation

The final documentation refresh changes no runtime source or dependencies. All 72 relative links and local heading anchors across eight reader-facing Markdown files resolve. The README overview, component flow and turn-switch sequence diagrams were parsed and rendered with Mermaid 11. Staged whitespace and configured-credential checks passed. README links now point to the deployed translator and dashboard; setup, model names and configuration descriptions were checked against the source. Application test results above remain the dated runtime verification, rather than being presented as newly rerun for a documentation-only change.
