# Production verification — 2026-10-16

## Public acceptance

Frontend: https://real-time-ai-voice-translator.vercel.app

Backend health: https://voice-translator-backend-u725.onrender.com/health

Readiness: https://voice-translator-backend-u725.onrender.com/ready

Vercel production deployment `dpl_8SU2Ghzn7g21CJxW7okYy2NPWSd7` built commit `1a837ce` successfully using Next.js 16.4.2 and was promoted to the public domain. Render deployment `dep-db8ntonavr4c739gvn20` is live on backend commit `2e4a8ea`.

A Chrome session loaded the public page, granted its synthetic microphone access, and fed a 48 kHz WAV speech fixture through the actual AudioWorklet. No backend or provider responses were mocked in this acceptance run.

- Input: “Hello, how are you today? It is nice to meet you.”
- Actual Groq STT output: “Hello, how are you today? It is nice to meet you.”
- Actual Groq translation: “नमस्ते, आप आज कैसे हैं? आपसे मिलकर खुशी हुई।”
- Actual ElevenLabs audio: 307,616 bytes of 48 kHz PCM received over `wss://` and scheduled in 151 Web Audio chunks.
- AudioContext was running for playback. Replay scheduled audio successfully without another provider request.
- Stop acknowledged after draining the pipeline; all acquired microphone tracks reached `ended`.
- No browser JavaScript errors occurred.

This verifies automated capture/transport/provider output/playback scheduling. It does not claim subjective listening assessment, physical microphone hardware coverage or exhaustive translation quality for every supported language. The first acceptance attempt loaded the previous frontend before the new Vercel alias was promoted; the test was repeated after confirming deployment Ready and passed.

The same live test also passed locally at `http://127.0.0.1:3100` with `ws://localhost:8000/ws/translate`: identical English/Hindi captions, 303,160 PCM bytes received in 149 chunks, replay succeeded, microphone tracks ended, and no browser errors occurred. The ignored backend environment has private `0600` permissions and the same verified free provider configuration.

## Automated results

| Check | Result |
| --- | --- |
| Backend unittest suite | 18 passed |
| AudioWorklet framing and tail flush | 2 passed |
| Chrome regression checks on local and public frontend | 6 passed |
| Frontend ESLint | No issues |
| TypeScript | No errors |
| Next.js production build, local and Vercel | Passed |
| Automated WCAG 2/2.1 A/AA scan, desktop and mobile | Zero violations |
| Production npm dependency audit | Zero vulnerabilities |
| Backend public `/health` and `/ready` | HTTP 200 |
| CORS from production frontend | Exact production origin allowed |
| Tracked-source and frontend bundle secret checks | No credential matches |
| README files versus owner's upstream base `c5872b4` | Unchanged |

Browser regressions exercise framing, final captions/audio on Stop, microphone release, native language selector and no horizontal overflow at 1440/390/320 px, permission denial/retry, cancellation during pending permission, cancellation during cold start, and invalidation of delayed replay after Clear.

An independent review found a Stop/full-queue/provider-error race and delayed replay cancellation race. Reproducing regressions were observed failing, fixes applied, and the suites passed afterward. Sandbox restrictions blocked async/thread and Turbopack subprocess port access; those checks were rerun successfully with authorized execution outside the sandbox.

## Milestone commits

- `8a81504` — stabilize translation sessions and configure Render Free.
- `ba63199` — owner-approved working free Groq translation fallback.
- `2e4a8ea` — propagate provider failures while draining final speech.
- `1a837ce` — polished Relay interface, audio lifecycle, browser/worklet tests and patched dependencies.

## Remaining limits

- Utterance-level translation with network/provider latency; not simultaneous interpretation.
- Render Free cold starts and workspace-shared included-hour/bandwidth/build allowances.
- Two concurrent sessions, three minutes and 600 synthesis characters per session; daily process budget 1,000 synthesis characters.
- Counters reset on process restart; the provider's Free credits enforce the actual monthly ceiling.
- Seven synthesis-compatible target languages; Telugu is excluded from Multilingual v2.
- Five development-only npm high advisories remain in the upstream ESLint glob dependency chain, with no compatible fix available. Production dependency audit is clean.
- Provider credentials shared in chat need owner rotation through secure environment settings.
- ElevenLabs Free supports non-commercial output with attribution. The page title/footer identify elevenlabs.io.

Vercel Hobby, Render Free and ElevenLabs Free were verified. ElevenLabs reported 10,000 monthly credits and paid overage disabled. Groq requests used a model advertised in its Free limits and available to this account. No paid resource, subscription upgrade, credit purchase or additional infrastructure was enabled.
