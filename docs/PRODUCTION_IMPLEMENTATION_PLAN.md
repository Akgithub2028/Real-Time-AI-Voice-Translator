# Production demo implementation plan

Goal: an accessible, light-theme portfolio demo with functioning utterance-level voice translation, deployed on Vercel Hobby and Render Free with no paid services.

Architecture: preserve Next.js → FastAPI WebSocket → Groq Whisper → Groq GPT-OSS 20B → ElevenLabs (owner-approved free fallback from unavailable Llama). Keep mono 48 kHz signed PCM browser transport and 24 kHz synthesis. No database or additional infrastructure.

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

- [x] Reproduce failures and inspect Render settings/build logs.
- [x] Add regression tests for handshake/origin validation, stop/finalization, event-loop responsiveness, bounded input, quotas, session cleanup and PCM framing.
- [x] Separate fast VAD ingestion from serialized provider work using a bounded utterance queue. Offload lazy provider iteration, retaining progressive transcript/audio delivery.
- [x] Enforce session duration (180 seconds), two active sessions, 600 synthesized characters per session, global request-rate and character budgets, input pacing/size and bounded pending work.
- [x] Add lazy provider clients, finite network timeouts, sanitized actionable errors, readiness and health endpoints, explicit environment configuration.
- [x] Confirm compatible dependency versions and Render's actual entry point; add reproducible Free deployment configuration.
- [x] Run backend tests, commit and push.

## Milestone 2 — functional, polished frontend

- [x] Buffer AudioWorklet data to 20 ms packets; flush the tail before Stop.
- [x] Implement a dedicated session hook with connecting/waking/listening/processing/stopping/error states; handshake-gated microphone access; stale-session guards and teardown on stop, failure, disconnect and unmount.
- [x] Resume playback from the initial user gesture, schedule PCM without overlaps, preserve final playback, prevent microphone feedback, and expose replay/status.
- [x] Build a responsive off-white interface with teal accents, accessible native language selection, microphone control/waveform, bilingual paired transcripts, usage and clear loading/error states.
- [x] Verify worklet framing/tail tests, lint, typecheck, production build and browser behavior at desktop/mobile widths. Commit and push.

## Milestone 3 — production deployment and acceptance

- [x] Verify current free-plan terms, account/service plan and quota availability; never enable a paid feature.
- [x] Configure Render service/environment/origins and deploy; verify `/health`, `/ready` and WebSocket controls.
- [x] Configure Vercel's public `NEXT_PUBLIC_WS_URL` with Render `wss://`; deploy the production frontend.
- [x] Run public acceptance including real provider calls and browser audio when credentials/quotas permit. Record actual evidence, URLs and limitations.
- [x] Update environment examples and separate deployment documentation, then commit/push verified documentation. Leave all README files unchanged per the owner's instruction; defer README deployment links until the entire task is complete and the owner requests them.

## Review focus

Cancellation during pending microphone permission; microphone release while final audio drains; slow providers while socket input continues; malformed/oversized messages and queue overload; quota failures after captions arrive; unsupported synthesis languages; mobile audio policies; service cold starts and restarts.

## Execution evidence

- All four requested audit documents found and read.
- Actual backend entry point is `src.main:app` from the `backend` directory.
- GitHub authenticated login verified over network; Vercel existing project identified.
- Existing Render CLI credential initially returned HTTP 401; the official CLI refreshed authentication successfully, enabling configuration and deployment.

## Final implementation rulings and evidence

- Owner approved `openai/gpt-oss-20b` and a compatible built-in ElevenLabs voice after live HTTP 404/402 failures on the original model/voice. Sarah passed a live synthesis request; ElevenLabs remains Free with overage disabled.
- An independent read-only review found a full-queue Stop/provider-error race and a pending replay/Clear race. Both received reproducing regression tests and fixes.
- Backend: 18 regression/integration tests pass. Frontend: two worklet tests and six Chrome lifecycle/layout checks pass; lint, TypeScript and production builds pass. Desktop/mobile WCAG automated scans found no violations.
- Next.js upgraded within version 16 to 16.4.2 to remove critical production advisories. Production dependency audit reports zero vulnerabilities; remaining dev-only glob advisories are recorded in DEPLOYMENT.md.
- Render is live with corrected Python commands. Vercel production build and deployment are Ready on commit `1a837ce`.
- Public live acceptance passed through the actual microphone/worklet/WebSocket and all AI stages: English fixture transcribed accurately, Hindi caption received, 307,616 PCM audio bytes received and scheduled, replay worked, microphone tracks ended, and there were no browser errors.
- Source and compiled-frontend checks contain no API credentials. Both README files are unchanged from the owner's latest upstream commit.
