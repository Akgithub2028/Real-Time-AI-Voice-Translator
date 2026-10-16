# Streaming conversation and observability implementation plan

Goal: extend the existing free-tier voice translator with faster TTS, measured turns, two-way conversation, controlled interruption and a lightweight health dashboard. Preserve the existing Next.js/FastAPI architecture and README files. No additional infrastructure or paid services.

The owner approved implementation, verification, commits, pushes and deployment. Work inline in the existing checkout. Preserve pre-existing untracked audit and `.serena/` files. A local-only research note is explicitly gitignored and must never be staged.

## Design and contracts

- Use ElevenLabs `text_to_speech.stream`, default configurable `TTS_MODEL=eleven_flash_v2_5`, with the verified built-in free voice and PCM format. Retain Multilingual v2 as an environment-selectable alternative.
- Retain protocol v1 compatibility. The new frontend negotiates protocol 2. Every turn has an increasing integer ID; each utterance has a session-unique integer ID. V2 binary output includes an eight-byte big-endian turn/utterance header before PCM, so stale audio can be rejected reliably.
- V2 microphone packets contain a four-byte turn ID and an eight-byte client speech-end timestamp followed by PCM. The timestamp is only used for browser timing, never for quota/security decisions. Input is bounded and paced using PCM bytes.
- A single processing worker remains per session. Interrupt marks the old pipeline cancelled, discards its queued work, installs the new language direction, and acknowledges immediately. In-flight synchronous provider calls finish within their existing timeout before the worker advances; their results are discarded. Slots and budgets remain reserved correctly. Do not promise a quota refund for already-issued requests.
- Capture stays active while playback runs; normal forwarding is gated to reduce feedback. An explicit interrupt/speaker-switch button stops playback immediately, preserves existing captions/replay, and retains a bounded 200 ms input pre-roll plus audio arriving during acknowledgement. Automatic acoustic interruption is outside this scope.
- Add per-utterance queue, endpoint, STT, translation and first-audio timings. Browser measures speech end to first received/scheduled playback using its own clock. Keep client observations distinct from server metrics and cold-start connection timing.
- Add bounded in-memory metrics and structured content-free logs. `/metrics` exposes aggregate session/utterance counts, provider stage status, recent durations, errors, current limits and uptime, never transcripts, audio, credentials or client addresses. Counters/window reset on restart.
- Add `/status` to the frontend. Fetch real backend health/readiness/metrics only while visible; show configured versus observed provider health honestly, sample counts, last success, error counts and latency summaries. No external monitoring vendor, database, keep-alive bot or paid add-on.
- Correct proxy metadata trust at the managed Render ingress so rate limits use the visitor address, preserving global limits.

## Milestone 1 — streaming, protocol and backend monitoring

- [x] Add failing tests for streamed TTS, explicit recognition language, stage timing, turn switching, stale output rejection, bounded interruption, slot cleanup and private aggregate metrics.
- [x] Extend existing pipeline and transport incrementally; preserve v1 stop/drain behavior.
- [x] Add aggregate monitoring and structured logs; update backend environment/deployment settings.
- [x] Run backend suite, inspect diff, commit and push the verified milestone.

## Milestone 2 — two-way controls, cancellation and timing UI

- [x] Add browser regressions for language direction, immediate interruption, stale audio, retained first speech, replay and microphone release.
- [x] Extend the existing hook and UI for protocol 2, speaker/language controls, timing and responsive monitoring dashboard.
- [x] Run worklet/browser tests, lint, TypeScript, build and accessibility checks.
- [x] Independent review; reproduce/fix important findings, then commit/push.

## Milestone 3 — deployed acceptance and documentation

- [x] Configure free provider model and proxy trust through existing CLI/API access; verify service plans remain Free/Hobby.
- [x] Verify deployed English→Hindi and Hindi→English, interruption without stale audio, playback/replay, health dashboard, error paths and private note exclusion.
- [x] Record measured evidence and limitations in separate deployment docs; leave README unchanged. Commit/push the verified documentation.

## Execution ledger

- Baseline: existing production demo and tests inspected; no new infrastructure required.
- Owner-selected scope excludes adaptive endpointing. Preserve the fixed 600 ms boundary.

- Backend verification: 27 unittest checks pass, including cancellation at provider boundaries, v1 compatibility, v2 switching, bounded interruption and private metrics. Independent review identified a provider-boundary cancellation gap; fixed and covered by regression.
- Frontend verification: nine browser scenarios and two worklet checks pass; lint, TypeScript/build pass. Translator and status dashboard have zero axe WCAG A/AA violations at 1440 px and 390 px; no overflow at 320/390/1440 px. Independent review cooldown and completed-caption labelling findings fixed.
- Backend milestone pushed: `36f7891`. Render Free model and managed ingress settings configured through the authenticated API.
- Live acceptance passed locally and publicly: English→Hindi→English on one socket, playback interruption, retained captions, replay, released microphone and real provider dashboard observations. Final warm public browser speech-end→scheduled playback: 1,657/1,680 ms; small sample only, not an SLA.
- Frontend milestone pushed: `1c2738b`; Vercel production Ready on Hobby. Render live backend `36f7891` on Free; ElevenLabs Free confirmed with paid credit extension disabled. Final evidence is in `docs/PRODUCTION_VERIFICATION.md`.
