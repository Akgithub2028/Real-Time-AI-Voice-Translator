"use client";

import { useEffect, useRef, useState } from "react";

const LANGUAGES = [
  "English", "Hindi", "Tamil", "Telugu",
  "Spanish", "French", "German", "Japanese",
];

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/translate";
const MIC_SAMPLE_RATE = 48000;
const BAR_COUNT = 28;

interface Transcript {
  source_text: string;
  translated_text: string;
}

export default function Home() {
  const [targetLanguage, setTargetLanguage] = useState("Hindi");
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setLangMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function startRecording() {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const playbackCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    playbackCtxRef.current = playbackCtx;
    nextPlayTimeRef.current = playbackCtx.currentTime;

    ws.onopen = async () => {
      ws.send(JSON.stringify({ target_language: targetLanguage }));
      await startMicCapture(ws);
      setIsRecording(true);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);
        if (msg.type === "transcript") {
          setTranscripts((prev) => [
            ...prev,
            { source_text: msg.source_text, translated_text: msg.translated_text },
          ]);
        }
      } else {
        playAudioChunk(event.data as ArrayBuffer);
      }
    };

    ws.onclose = () => setIsRecording(false);
    ws.onerror = (err) => console.error("WebSocket error:", err);
  }

  async function startMicCapture(ws: WebSocket) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: MIC_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const captureCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    captureCtxRef.current = captureCtx;

    await captureCtx.audioWorklet.addModule("/pcm-processor.js");
    const source = captureCtx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(captureCtx, "pcm-processor");

    let lastVisualUpdate = 0;

    workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event.data);
      }

      const now = performance.now();
      if (now - lastVisualUpdate > 66) {
        lastVisualUpdate = now;
        const samples = new Int16Array(event.data);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        setAmplitude(Math.min(1, rms / 6000));
      }
    };

    source.connect(workletNode);
  }

  function playAudioChunk(buffer: ArrayBuffer) {
    const playbackCtx = playbackCtxRef.current;
    if (!playbackCtx) return;

    const int16 = new Int16Array(buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
    }

    const audioBuffer = playbackCtx.createBuffer(1, float32.length, MIC_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = playbackCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackCtx.destination);

    const startTime = Math.max(nextPlayTimeRef.current, playbackCtx.currentTime);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + audioBuffer.duration;
  }

  function stopRecording() {
    wsRef.current?.close();
    captureCtxRef.current?.close();
    playbackCtxRef.current?.close();
    setIsRecording(false);
    setAmplitude(0);
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-14 gap-10">
      {/* Header */}
      <header className="flex flex-col items-center gap-3 text-center">
        <span
          className="text-[11px] uppercase tracking-[0.35em]"
          style={{ color: "var(--text-muted)" }}
        >
          Speak · Listen · Understand
        </span>
        <h1 className="font-display text-4xl font-medium tracking-tight">
          Real-Time Voice Translator
        </h1>
        <div
          className="h-px w-16 mt-1"
          style={{ background: "linear-gradient(90deg, var(--amber), var(--teal))" }}
        />
      </header>

      {/* Language selector */}
      <div className="relative" ref={langMenuRef}>
        <button
          onClick={() => !isRecording && setLangMenuOpen((v) => !v)}
          disabled={isRecording}
          className="glass-card flex items-center gap-3 rounded-full pl-4 pr-2 py-2 disabled:opacity-50"
          aria-haspopup="listbox"
          aria-expanded={langMenuOpen}
          aria-label="Select target language for translation"
          style={{ cursor: isRecording ? "not-allowed" : "pointer" }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Translate to
          </span>
          <span className="text-sm font-medium px-2" style={{ color: "var(--teal)" }}>
            {targetLanguage}
          </span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"
            style={{ transform: langMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {langMenuOpen && (
          <div
            className="fixed inset-0 z-[5]"
            style={{ background: "rgba(10, 14, 26, 0.6)", backdropFilter: "blur(2px)" }}
            onClick={() => setLangMenuOpen(false)}
          />
        )}

        {langMenuOpen && (
          <ul
            role="listbox"
            className="glass-card absolute top-full mt-1 left-0 right-0 rounded-2xl py-2 z-10 shadow-2xl"
            style={{ background: "var(--surface-solid)" }}
          >
            {LANGUAGES.map((lang) => (
              <li
                key={lang}
                role="option"
                aria-selected={lang === targetLanguage}
                onClick={() => {
                  setTargetLanguage(lang);
                  setLangMenuOpen(false);
                }}
                className="px-4 py-2 text-sm transition-colors"
                style={{
                  color: lang === targetLanguage ? "var(--teal)" : "var(--text)",
                  background: lang === targetLanguage ? "rgba(79, 209, 197, 0.1)" : "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(242, 166, 90, 0.1)")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    lang === targetLanguage ? "rgba(79, 209, 197, 0.1)" : "transparent")
                }
              >
                {lang}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Signature element: waveform + mic button */}
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-end gap-[3px] h-16">
          {Array.from({ length: BAR_COUNT }).map((_, i) => {
            const phase = Math.abs(Math.sin((i / BAR_COUNT) * Math.PI));
            const height = isRecording
              ? Math.max(6, amplitude * 64 * (0.5 + phase * 0.5))
              : 6;
            return (
              <div
                key={i}
                style={{
                  width: 4,
                  height,
                  borderRadius: 2,
                  background: `linear-gradient(180deg, var(--amber), var(--teal))`,
                  transition: "height 90ms ease-out",
                  opacity: isRecording ? 1 : 0.2,
                }}
              />
            );
          })}
        </div>

        <div className="relative">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "linear-gradient(135deg, var(--amber), var(--teal))",
              filter: "blur(20px)",
              opacity: isRecording ? 0.6 : 0.15,
              transition: "opacity 0.3s ease",
            }}
          />
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center font-medium transition-transform active:scale-95 shadow-2xl ${
              isRecording ? "mic-active" : ""
            }`}
            style={{
              background: isRecording
                ? "linear-gradient(135deg, var(--amber), var(--teal))"
                : "var(--surface-solid)",
              border: `1px solid ${isRecording ? "transparent" : "var(--surface-border)"}`,
              cursor: "pointer",
            }}
            aria-label={isRecording ? "Stop speaking" : "Start speaking"}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isRecording ? "#0a0e1a" : "var(--text)"}
              strokeWidth="2"
              strokeLinecap="round"
            >
              {isRecording ? (
                <rect x="6" y="6" width="12" height="12" rx="2" fill={"#0a0e1a"} />
              ) : (
                <>
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <path d="M12 17v4" />
                </>
              )}
            </svg>
          </button>
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {isRecording ? "Listening — tap to stop" : "Tap to start speaking"}
        </span>
      </div>

      {/* Caption feed */}
      <div className="w-full max-w-xl flex flex-col gap-3">
        {transcripts.length === 0 && (
          <p
            className="text-center text-sm py-8"
            style={{ color: "var(--text-muted)" }}
          >
            Your conversation will appear here as captions once you start speaking.
          </p>
        )}
        {transcripts.map((t, i) => (
          <div
            key={i}
            className="glass-card caption-enter rounded-2xl px-5 py-4 font-mono-caption text-sm shadow-lg"
          >
            <p style={{ color: "var(--amber)" }}>{t.source_text}</p>
            <div
              className="my-2 h-px w-8"
              style={{ background: "linear-gradient(90deg, var(--amber), var(--teal))" }}
            />
            <p style={{ color: "var(--teal)" }}>{t.translated_text}</p>
          </div>
        ))}
        <div ref={feedEndRef} />
      </div>

      {/* Footer */}
      <footer className="mt-auto pt-8 pb-4 text-center">
        <p className="text-xs tracking-wider" style={{ color: "var(--text-muted)" }}>
          Developed by{" "}
          <a
            href="https://github.com/Akgithub2028"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:underline"
            style={{ color: "var(--teal)" }}
          >
            Aayaann Kausar
          </a>
        </p>
      </footer>
    </main>
  );
}