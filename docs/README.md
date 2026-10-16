# Documentation

[▶ Live translator](https://real-time-ai-voice-translator.vercel.app) · [▶ Live dashboard](https://real-time-ai-voice-translator.vercel.app/status) · [Project overview](../README.md)

Relay translates spoken utterances through a Next.js frontend and a FastAPI WebSocket backend, using Groq for recognition/translation and ElevenLabs for streamed speech. The deployed demo uses free service tiers.

| Guide | What it covers |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Audio flow, component responsibilities, same-connection turn changes, protocol and metric semantics |
| [Deployment and operations](DEPLOYMENT.md) | Vercel/Render settings, environment variables, free-tier constraints, monitoring and troubleshooting |
| [Testing](TESTING.md) | Repeatable checks, browser prerequisites and manual end-to-end validation |
| [Recorded verification](PRODUCTION_VERIFICATION.md) | Dated test results, deployed revisions, live acceptance and measured latency |
| [Frontend](../frontend/README.md) | Local UI setup, audio lifecycle and dashboard implementation |
| [Backend](../backend/README.md) | Local API setup, endpoints, pipeline modules and operational safeguards |

## Reading paths

- **Try it:** launch the translator, choose two languages, speak and pause; use **Switch speaker** to reverse direction. Headphones are recommended.
- **Run it:** follow the root [local setup](../README.md#-local-setup), then use the component guides for details.
- **Understand it:** read the architecture guide, especially controlled interruption and the distinction between server and browser clocks.
- **Operate it:** use the deployment guide and live dashboard. Readiness means configuration is present; provider observations come from real requests.
- **Evaluate it:** start with the recorded verification, then run the testing guide. Small latency samples and automated playback scheduling checks are not an exhaustive quality evaluation.

The public docs describe the implemented system and its measured limits. Provider quotas, model availability and hosting behavior can change; check the linked primary documentation before changing deployment settings.
