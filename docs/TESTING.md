# Testing and verification

[Overview](../README.md) · [Recorded results](PRODUCTION_VERIFICATION.md) · [Architecture](ARCHITECTURE.md)

The automated suites test audio framing, lifecycle, cancellation, protocol behavior and real metric calculation using mocked providers. Real-provider acceptance is a separate, quota-consuming check. Recorded results are dated evidence, not a promise that provider availability or quotas never change.

## Backend

With the backend virtual environment active and requirements installed, from `backend`:

```bash
python -m unittest discover -s tests -v
```

Coverage includes:

- RMS detection, resampling, VAD buffering, short-noise filtering and tail flush.
- Async transport responsiveness while synchronous provider work is slow.
- Protocol 1 Stop/drain compatibility and full-queue/provider-error handling.
- Protocol 2 source-language hints, same-socket switching, tagged audio and measured stage durations.
- Immediate interruption acknowledgement while an old provider call is blocked; no later provider stage starts after cancellation.
- Request/character reservations, slot release, origin checks, malformed/oversized messages and session timeout.
- Bounded metrics, correct percentile calculations, sanitized provider failures and recovery observations.

The recorded suite has **27 tests**. Its FastAPI/Starlette test client emits an upstream httpx deprecation warning; see the dated report for the verified environment.

## Frontend checks

From `frontend` after `npm ci`:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

The two worklet tests verify 20 ms frame buffering and a partial-frame flush before Stop acknowledgement. Lint/type/build validate the source and production bundle; production dependency audit is separate from the full development dependency audit.

## Browser regressions

The suite requires **Google Chrome** and the pinned Playwright dependency from `npm ci`; it launches `channel: "chrome"` in headless mode with a synthetic microphone. A Playwright Chromium download alone does not satisfy that channel setting.

Build, then start the frontend on port 3100:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
```

In another terminal in `frontend`:

```bash
npm run test:browser
```

Optional overrides on Unix:

```bash
TEST_BASE_URL=https://real-time-ai-voice-translator.vercel.app npm run test:browser
SCREENSHOT_DIR=/tmp npm run test:browser
```

These tests intercept readiness, metrics and WebSocket responses. They do not require an active backend or provider keys and do not consume AI quota, including against the deployed frontend. They exercise actual worklet/Web Audio/microphone resource behavior in Chrome.

Nine scenarios cover measured dashboard values and failed refreshes; immediate playback interruption/stale-audio rejection; source/target swapping on one connection; acknowledgement buffering/pre-roll with concurrent Stop; retained final captions/audio and replay; framing and microphone release; pending replay cancellation; permission denial/retry and cancellation; cold-start cancellation; and responsive layouts at 320/390/1440 px.

## Accessibility and presentation

The recorded evaluation used axe-core with WCAG 2 A/AA and WCAG 2.1 AA tags on both `/` and `/status`, at desktop and mobile widths. A current scan should be paired with manual keyboard navigation:

1. Tab through language controls, microphone, interruption controls, timing details, copy/replay and dashboard links.
2. Confirm visible focus, meaningful labels and status/error announcements.
3. On mobile, check that the latency table scrolls within its focusable region without page overflow.
4. Check reduced-motion behavior, zoom and contrast in each loading/error state.

Automated scans do not establish complete accessibility or physical-device coverage.

## Real-provider acceptance checklist

Use a quiet room and headphones. Configure only Free-accessible models/voice and keep within the demo/provider limits. Each translation can consume recognition, translation and synthesis quota; dashboard polling and replay do not.

1. Confirm `/health`, `/ready` and `/metrics` return successfully and the dashboard labels provider observations honestly. A fresh process may correctly show no observations.
2. Open the deployed translator, select English→Hindi, start and allow microphone access. Confirm capture begins only after server acceptance.
3. Speak a short sentence and pause. Check source/translated captions, incremental voice playback, turn timings and separate connection timing.
4. During playback, click **Switch speaker**. Confirm playback stops, selectors reverse, prior captions remain and the microphone/connection stay active.
5. Speak Hindi and confirm English captions/voice. Check that no old-turn audio restarts. Use **Interrupt & speak** to test a new turn without reversing direction.
6. Stop. Verify the browser microphone indicator clears, final accepted work drains, and replay/copy work without a new provider request.
7. Open the dashboard. Check actual completion/failure counts, provider observations, latency samples and released capacity; hide it and confirm polling pauses.
8. Test denied permission, cancellation during startup, an unavailable backend and a fresh manual session after disconnect. Simulate provider quota/auth failures with mocks rather than intentionally exhausting credits.
9. Review sanitized application events in Render; do not log keys, recordings or transcripts for debugging.

For repeatable audio, feed a known speech fixture through a synthetic Web Audio microphone into the real worklet and leave WebSocket/provider responses unintercepted. The recorded two-way acceptance reused the actual Hindi synthesis as the second turn's input. This verifies the integrated pipeline and scheduling, not human microphone quality or subjective listening.

## Interpret latency correctly

Server endpoint, queue and provider durations share one server monotonic clock. Browser speech-end→scheduled playback uses the browser's clock and audio scheduler. Never subtract timestamps from different machines. Cold-start/connection time is separate. Include sample count, language, utterance length and warm/cold conditions when reporting results; two observations do not establish a latency SLA.

## Documentation-only changes

For documentation changes, validate relative links, local heading anchors, Mermaid syntax, command/model/config names against the source, and the staged file set. Ensure ignored secrets, private notes and coding plans are not staged. Application builds or paid/quota-consuming calls do not need to be repeated when only documentation changes.
