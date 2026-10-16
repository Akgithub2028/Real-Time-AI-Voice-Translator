# Production demo implementation plan

Goal: an accessible, light-theme portfolio demo with functioning utterance-level voice translation, deployed on Vercel Hobby and Render Free with no paid services.

Architecture: preserve Next.js → FastAPI WebSocket → Groq Whisper → Groq Llama → ElevenLabs. Keep mono 48 kHz signed PCM browser transport and 24 kHz synthesis. No database or additional infrastructure.

Authorization: the owner explicitly authorized implementation, milestone commits/pushes, configuration and deployment through CLI/integrations on 2026-10-16, without intermediate approval gates. Execute inline in this checkout; leave unrelated `.serena/` files untouched. Push verified milestones to the existing deployment branch, `main`, without force-push.

## Audit corrections to verify

- `requirements.txt` uses unbounded lower bounds, not reproducible pins.
- Two concurrent sessions do not enforce provider requests-per-minute limits.
- Offloading a generator's creation does not offload its iteration; advance it in a worker, with bounded queues and cancellation.
- Browser audio capture is not universally 48 kHz. Explicitly request and verify the context rate.
- A minimum buffer length including silence does not prove sufficient speech.
- Provider model availability, voice permissions, supported languages and free-plan licensing require current verification; do not blindly adopt latency flags.
- Origin checks protect browsers, not arbitrary clients. Quota budgets remain necessary, and in-memory counters reset on restart.
- Free-tier cold starts can exceed the audit's suggested 45 seconds.
- Previous audit measurements and passed checks are historical claims, not validation of this implementation.

## Milestone 1 — backend reliability and Render readiness

- [ ] Reproduce failures and inspect Render settings/build logs.
- [ ] Add regression tests for handshake/origin validation, stop/finalization, event-loop responsiveness, bounded input, quotas, session cleanup and PCM framing.
- [ ] Separate fast VAD ingestion from serialized provider work using a bounded utterance queue. Offload lazy provider iteration, retaining progressive transcript/audio delivery.
- [ ] Enforce session duration (180 seconds), two active sessions, 600 synthesized characters per session, global request-rate and character budgets, input pacing/size and bounded pending work.
- [ ] Add lazy provider clients, finite network timeouts, sanitized actionable errors, readiness and health endpoints, explicit environment configuration.
- [ ] Confirm compatible dependency versions and Render's actual entry point; add reproducible Free deployment configuration.
- [ ] Run backend tests, commit and push.

## Milestone 2 — functional, polished frontend

- [ ] Buffer AudioWorklet data to 20 ms packets; flush the tail before Stop.
- [ ] Implement a dedicated session hook with connecting/waking/listening/processing/stopping/error states; handshake-gated microphone access; stale-session guards and teardown on stop, failure, disconnect and unmount.
- [ ] Resume playback from the initial user gesture, schedule PCM without overlaps, preserve final playback, prevent microphone feedback, and expose replay/status.
- [ ] Build a responsive off-white interface with teal accents, accessible native language selection, microphone control/waveform, bilingual paired transcripts, usage and clear loading/error states.
- [ ] Verify worklet framing/tail tests, lint, typecheck, production build and browser behavior at desktop/mobile widths. Commit and push.

## Milestone 3 — production deployment and acceptance

- [ ] Verify current free-plan terms, account/service plan and quota availability; never enable a paid feature.
- [ ] Configure Render service/environment/origins and deploy; verify `/health`, `/ready` and WebSocket controls.
- [ ] Configure Vercel's public `NEXT_PUBLIC_WS_URL` with Render `wss://`; deploy the production frontend.
- [ ] Run public acceptance including real provider calls and browser audio when credentials/quotas permit. Record actual evidence, URLs and limitations.
- [ ] Update environment examples and separate deployment documentation, then commit/push verified documentation. Leave all README files unchanged per the owner's instruction; defer README deployment links until the entire task is complete and the owner requests them.

## Review focus

Cancellation during pending microphone permission; microphone release while final audio drains; slow providers while socket input continues; malformed/oversized messages and queue overload; quota failures after captions arrive; unsupported synthesis languages; mobile audio policies; service cold starts and restarts.

## Execution evidence

- All four requested audit documents found and read.
- Actual backend entry point is `src.main:app` from the `backend` directory.
- GitHub authenticated login verified over network; Vercel existing project identified.
- Existing Render CLI credential initially returned HTTP 401; refresh under investigation.
