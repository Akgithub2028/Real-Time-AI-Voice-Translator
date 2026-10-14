<div align="center">

# 🎙️ Real-Time AI Voice Translator

### High-Performance, Bidirectional Voice Translation Pipeline with Live Bilingual Captions

<p align="center">
  <b>Speak naturally into your microphone — listen to instantaneous synthesized speech in your target language while live captions stream side-by-side.</b>
</p>

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-14%2B-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![Groq](https://img.shields.io/badge/Groq-LPU_Inference-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com)
[![Whisper](https://img.shields.io/badge/Whisper-Large_v3_Turbo-2563EB?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/openai/whisper)
[![ElevenLabs](https://img.shields.io/badge/ElevenLabs-Streaming_TTS-6366F1?style=for-the-badge&logo=elevenlabs&logoColor=white)](https://elevenlabs.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge)](LICENSE)

<br/>

<p align="center">
  <a href="#-architecture"><b>Architecture</b></a> •
  <a href="#-key-features"><b>Key Features</b></a> •
  <a href="#-how-it-works"><b>How It Works</b></a> •
  <a href="#-tech-stack"><b>Tech Stack</b></a> •
  <a href="#-local-setup"><b>Local Setup</b></a> •
  <a href="#-deployment"><b>Deployment</b></a> •
  <a href="#-tuning-knobs"><b>Tuning Knobs</b></a> •
  <a href="#-author"><b>Author</b></a>
</p>

</div>

---

> [!TIP]
> **Zero Black-Box Lock-in:** Unlike monolithic speech APIs (e.g. Gemini Live), this project implements a decoupled **STT ➔ MT ➔ TTS** pipeline connected via asynchronous WebSockets. Every single layer is independently observable, bench-testable, and swappable.

---

## ✨ Key Features

* 🌐 **8 Supported Languages:** Seamlessly translate between English, Hindi, Tamil, Telugu, Spanish, French, German, and Japanese.
* ⚡ **RMS Energy-Based VAD:** Intelligent Voice Activity Detection analyzes 20ms audio frames in real time, chunking audio precisely on natural speech pauses rather than crude fixed timers.
* 🛡️ **Whisper Hallucination Shield:** Built-in sanitization filter prevents Whisper from generating ghost filler artifacts (`"."`, `"Thank you."`, `"Please subscribe"`) during silent or near-silent mic intervals.
* 🔊 **Polyphase Anti-Aliased Resampling:** Audio is captured at native 48kHz in an `AudioWorklet`, polyphase downsampled to 16kHz for STT, synthesized at 24kHz PCM by ElevenLabs, and upsampled back to 48kHz for pristine, gapless Web Audio playback.
* 🌊 **Reactive Dark-Glass UI:** Modern glassmorphism interface featuring a live 28-bar audio frequency visualizer, real-time status pulses, and a bilingual chat stream.
* 💬 **Dual Bilingual Captions:** Displays source transcript and translated output side-by-side with minimal latency.

---

## 🏗️ Architecture

The diagram below illustrates the end-to-end data lifecycle from browser capture to speech synthesis:

```mermaid
flowchart TD
    subgraph Browser["Browser (Next.js)"]
        A[Mic Input] --> B["AudioWorklet (float32 → int16 PCM)"]
        B -->|WebSocket, raw PCM 48kHz| C
        H[Speaker]
    end

    subgraph Backend["Backend (FastAPI)"]
        C["VAD (20ms frame energy check)"] -->|speech buffered until pause| D["Groq Whisper (Speech-to-Text)"]
        D -->|hallucination filter| E["Groq Llama-3.3-70B (Translation)"]
        E --> F["ElevenLabs (Text-to-Speech, streaming)"]
        F -->|24kHz PCM| G["Upsample 24kHz → 48kHz"]
    end

    G -->|WebSocket, binary| H
    D -.->|transcript JSON| I["Live Captions (source + translated)"]
    E -.->|transcript JSON| I

    style Browser fill:#0a0e1a,stroke:#4fd1c5,color:#e8ecf4
    style Backend fill:#121a2e,stroke:#f2a65a,color:#e8ecf4
```

---

## 🔬 How It Works

### The End-to-End Pipeline (Step-by-Step)

```
[Browser Mic] ➔ [AudioWorklet] ➔ [WebSocket] ➔ [VAD Detection] ➔ [Groq Whisper STT]
                                                                        ↓
[Browser Speaker] ← [WebSocket] ← [24k→48k Upsample] ← [ElevenLabs TTS] ← [Groq LLaMA MT]
```

1. **Audio Capture (`AudioWorklet`):** Browser captures microphone audio at 48kHz mono. A dedicated background audio thread converts raw `float32` samples to `int16` PCM frames without blocking UI renders.
2. **Streaming Transport:** Raw PCM chunks are transmitted via WebSocket binary frames directly to the FastAPI server.
3. **Voice Activity Detection (`vad.py`):** The server analyzes incoming audio in 20ms windows using Root-Mean-Square (RMS) energy. Once speech starts, audio accumulates in a buffer until a natural pause (~600ms) is detected.
4. **Polyphase Downsampling (`stt.py`):** Buffered 48kHz PCM is downsampled to 16kHz using `scipy.signal.resample_poly` with anti-aliasing lowpass filtering, then packaged into an in-memory WAV container.
5. **Speech-to-Text (`stt.py`):** Groq Whisper (`whisper-large-v3-turbo`) transcribes the speech with sub-second latency.
6. **Hallucination Shield (`pipeline.py`):** Whisper silence artifacts (isolated punctuation, outro phrases like *"Thank you for watching"*) are caught and dropped before triggering downstream APIs.
7. **Machine Translation (`mt.py`):** Groq LLaMA (`llama-3.3-70b-versatile`) translates the transcript into the requested target language with a zero-temperature, strict system prompt.
8. **Streaming Text-to-Speech (`tts.py`):** ElevenLabs (`eleven_multilingual_v2`) synthesizes speech, streaming raw 24kHz PCM chunks as they are generated.
9. **Playback Scheduling:** Backend upsamples audio 24kHz ➔ 48kHz via sample repetition and streams binary frames back to the client; Web Audio API schedules seamless, gapless playback alongside live bilingual caption updates.

---

## 🧰 Tech Stack

| Layer | Technology | Primary Role | Key Advantage |
| :--- | :--- | :--- | :--- |
| **STT** | Groq Whisper (`whisper-large-v3-turbo`) | Speech-to-Text | LPU inference provides ultra-low STT latency |
| **MT** | Groq LLaMA (`llama-3.3-70b-versatile`) | Translation Engine | Full prompt control, high multilingual fidelity |
| **TTS** | ElevenLabs (`eleven_multilingual_v2`) | Text-to-Speech | True streaming 24kHz PCM output; natural inflection |
| **VAD** | Custom RMS Energy Detector | Speech Boundary Slicing | Lightweight, real-time, zero ML overhead |
| **Backend** | FastAPI + WebSockets | Ingestion & Orchestration | Native asynchronous event loop for high concurrent throughput |
| **Frontend** | Next.js 14 + Web Audio API | Client UI & Audio Capture | Off-main-thread processing via AudioWorklet |
| **Styling** | Vanilla CSS + TailwindCSS | Dark-Glass Design | Tailored typography, smooth CSS transitions, dynamic waveform |

---

## ⚙️ Local Setup

### Prerequisites

* **Python 3.10+** (Python 3.12 recommended)
* **Node.js 18+** & **npm**
* [Groq Cloud API Key](https://console.groq.com) (Free tier available)
* [ElevenLabs API Key](https://elevenlabs.io) (Free tier available)

---

### 1. Backend Setup

```bash
# Navigate to the backend directory
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create your environment file from the template
cp .env.example .env
```

Populate `backend/.env`:
```env
GROQ_API_KEY=your_groq_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
TTS_VOICE_ID=3AMU7jXQuQa3oRvRqUmb
```

> [!IMPORTANT]
> **ElevenLabs Free Tier Voice Configuration:** Default library voices (like "Rachel") return `402 Payment Required` on free tier accounts.
> 1. Visit [elevenlabs.io/app/voice-library](https://elevenlabs.io/app/voice-library).
> 2. Click on any voice and select **"Add to my voices"** (free).
> 3. Go to **My Voices**, copy the **Voice ID**, and paste it into `TTS_VOICE_ID` in your `.env`.

Start the FastAPI backend:
```bash
uvicorn src.main:app --reload --port 8000
```
Verify health: Navigate to `http://localhost:8000/health` (should return `{"status": "ok"}`).

---

### 2. Frontend Setup

```bash
# Navigate to the frontend directory
cd frontend

# Install Node modules
npm install

# Create local environment config
cp .env.local.example .env.local
```

Populate `frontend/.env.local`:
```env
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/translate
```

Start the Next.js development server:
```bash
npm run dev
```

Open `http://localhost:3000` in Chrome/Edge, grant microphone permission, choose your target language, and click **Tap to start speaking**!

---

## 🚀 Deployment

### Backend Deployment (Render / Railway)

1. Connect your repository to **Render** or **Railway**.
2. Set **Root Directory** to `backend`.
3. Set **Build Command** to: `pip install -r requirements.txt`
4. Set **Start Command** to: `uvicorn src.main:app --host 0.0.0.0 --port $PORT`
5. Configure Environment Variables: `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `TTS_VOICE_ID`.
6. Health check path: `/health`.

> [!NOTE]
> **Why not serverless (e.g. AWS Lambda / Vercel Serverless) for the backend?**
> This application relies on persistent, bidirectional WebSocket sessions for raw binary audio streaming. Serverless functions have execution timeouts and are not structured for long-lived full-duplex socket connections.

---

### Frontend Deployment (Vercel)

1. Import your repository into **Vercel**.
2. Set **Root Directory** to `frontend`.
3. Add the production WebSocket environment variable:
   ```env
   NEXT_PUBLIC_WS_URL=wss://your-backend.onrender.com/ws/translate
   ```
   *(Ensure you use `wss://` instead of `ws://` to prevent browser mixed-content blocks over HTTPS).*
4. Deploy.

---

## 🎛️ Tuning Knobs (`backend/src/config.py`)

All core heuristics can be customized in `config.py` or overridden via environment variables:

| Setting | Default | Description |
| :--- | :---: | :--- |
| `VAD_SILENCE_THRESHOLD` | `700` | RMS amplitude below which audio is classified as silence. Lower for quiet mics; raise in noisy rooms. |
| `VAD_SILENCE_DURATION_MS` | `600` | Duration of silence (ms) required to trigger a sentence boundary flush. |
| `VAD_MAX_CHUNK_SECONDS` | `8.0` | Maximum speech buffer duration (s) before forcing a flush to avoid latency build-up. |
| `VAD_MIN_CHUNK_SECONDS` | `0.3` | Minimum speech duration required to send to STT (filters out coughs and clicks). |
| `TTS_VOICE_ID` | `3AMU7jXQuQa3oRvRqUmb` | ElevenLabs Voice ID for streaming synthesis. |
| `LANGUAGES` | 8 languages | Target language options displayed in the frontend dropdown. |

---

## ⚠️ Known Limitations & Troubleshooting

<details>
<summary><b>1. Windows Long Path Installation Errors</b></summary>
<br/>
Windows path length limits (260 chars) can cause pip failures with packages like `elevenlabs`.
<br/>
<b>Solution:</b> Enable Windows Long Paths (`regedit` ➔ `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem` ➔ set `LongPathsEnabled = 1`), reboot, and re-create `.venv`.
</details>

<details>
<summary><b>2. ElevenLabs 402 Payment Required Error</b></summary>
<br/>
Occurs when attempting to use default preset library voices on the free tier.
<br/>
<b>Solution:</b> Add a voice to your personal ElevenLabs voice library at <code>elevenlabs.io/app/voice-library</code> and set its ID in <code>TTS_VOICE_ID</code>.
</details>

<details>
<summary><b>3. Mixed Content / WebSocket Connection Blocked</b></summary>
<br/>
Browser blocks <code>ws://</code> connections when the frontend is served over <code>https://</code>.
<br/>
<b>Solution:</b> Ensure <code>NEXT_PUBLIC_WS_URL</code> starts with <code>wss://</code> on production deployments.
</details>

<details>
<summary><b>4. Render Free Tier Cold Starts</b></summary>
<br/>
Render free web instances spin down after 15 minutes of inactivity. The first wake-up request may take ~30-50 seconds.
</details>

---

## 👤 Author

<div align="center">

### **Aayaann Kausar**

[![GitHub](https://img.shields.io/badge/GitHub-Akgithub2028-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Akgithub2028)
[![Repository](https://img.shields.io/badge/Repository-Real--Time--AI--Voice--Translator-0284C7?style=for-the-badge&logo=git&logoColor=white)](https://github.com/Akgithub2028/Real-Time-AI-Voice-Translator)

</div>

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
