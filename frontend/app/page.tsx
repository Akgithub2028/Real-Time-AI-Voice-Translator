"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslator } from "../hooks/use-translator";

const LANGUAGES: Record<string, { native: string; code: string }> = {
  English: { native: "English", code: "en" },
  Hindi: { native: "हिन्दी", code: "hi" },
  Tamil: { native: "தமிழ்", code: "ta" },
  Spanish: { native: "Español", code: "es" },
  French: { native: "Français", code: "fr" },
  German: { native: "Deutsch", code: "de" },
  Japanese: { native: "日本語", code: "ja" },
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16m-5-5 5 5-5 5" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    speaker: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4" />
      </>
    ),
    github: (
      <>
        <path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1-.1-2-1-2 3-.4 6-1.5 6-6a5 5 0 0 0-1.4-3.5 5 5 0 0 0-.1-3.5s-1.2-.4-3.6 1.3a13 13 0 0 0-7 0C5.5 1.6 4.3 2 4.3 2a5 5 0 0 0-.1 3.5A5 5 0 0 0 3 9c0 4.5 3 5.6 6 6-.8.7-1 1.8-1 3v4" />
      </>
    ),
    headphones: (
      <>
        <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
        <rect x="3" y="12" width="4" height="9" rx="2" />
        <rect x="17" y="12" width="4" height="9" rx="2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.globe}
    </svg>
  );
}

export default function Home() {
  const [language, setLanguage] = useState("Hindi");
  const [copied, setCopied] = useState(false);
  const t = useTranslator(language);
  const active = !["idle", "error"].includes(t.phase);
  const connecting = t.phase === "connecting" || t.phase === "waking";
  const busy = connecting || t.phase === "stopping";
  const time = `${Math.floor(t.elapsed / 60)
    .toString()
    .padStart(2, "0")}:${(t.elapsed % 60).toString().padStart(2, "0")}`;
  const status =
    t.phase === "waking"
      ? "Waking up the demo server…"
      : t.phase === "connecting"
        ? "Connecting to your conversation…"
        : t.phase === "stopping"
          ? "Finishing your last sentence…"
          : t.phase === "error"
            ? "Let’s try that again"
            : t.playing
              ? "Playing your translation"
              : t.phase === "listening"
                ? {
                    transcribing: "Turning your speech into text…",
                    translating: "Finding the right words…",
                    speaking: "Preparing translated audio…",
                  }[t.stage] || "Listening. Take your time."
                : "Ready when you are";

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(
        t.transcripts
          .map((x) => `${x.source_text}\n${x.translated_text}`)
          .join("\n\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#translator">
        Skip to translator
      </a>
      <header className="site-header">
        <Link
          className="brand"
          href="/"
          aria-label="Relay voice translator home"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            relay<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="header-right">
          <span className="demo-badge">
            <span /> A voice translation demo
          </span>
          <a
            className="source-link"
            href="https://github.com/Akgithub2028/Real-Time-AI-Voice-Translator"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="github" size={17} />
            <span>View source</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <main id="translator">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">LESS DISTANCE. MORE UNDERSTANDING.</p>
            <h1 id="page-title">
              Your voice. <span>A new language.</span>
            </h1>
            <p className="intro-description">
              Speak naturally, pause for a moment, and hear your words in
              another language.
            </p>
          </div>
          <div className="intro-note">
            <span className="small-orbit">
              <Icon name="globe" size={20} />
            </span>
            <div>
              <strong>One conversation, fewer barriers.</strong>
              <span>7 languages · voice &amp; live captions</span>
            </div>
          </div>
        </section>

        <section
          className="translator-card"
          aria-label="Voice translation workspace"
        >
          <div className="language-bar">
            <div className="language-source">
              <span className="language-icon">
                <Icon name="mic" size={19} />
              </span>
              <div>
                <span className="field-label">YOU SPEAK</span>
                <strong>Auto-detect language</strong>
              </div>
              <span className="auto-tag">Automatic</span>
            </div>
            <span className="language-arrow">
              <Icon name="arrow" size={21} />
            </span>
            <div className="language-target">
              <span className="language-icon">
                <Icon name="globe" size={19} />
              </span>
              <div className="select-wrap">
                <label className="field-label" htmlFor="target-language">
                  TRANSLATE INTO
                </label>
                <select
                  id="target-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={active}
                >
                  {Object.entries(LANGUAGES).map(([name, value]) => (
                    <option key={name} value={name}>
                      {name} · {value.native}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div
            className={`recording-studio ${t.phase === "listening" ? "is-listening" : ""}`}
          >
            <div className="studio-top">
              <span className={`connection-label ${active ? "connected" : ""}`}>
                <span />
                {active
                  ? connecting
                    ? "CONNECTING"
                    : "SESSION ACTIVE"
                  : "VOICE TRANSLATOR"}
              </span>
              <span className="session-clock">
                {time}
                <span> / 03:00</span>
              </span>
            </div>
            <div className="waveform" aria-hidden="true">
              {Array.from({ length: 49 }, (_, i) => {
                const envelope = Math.sin(((i + 1) / 50) * Math.PI);
                const variation = 0.4 + Math.abs(Math.sin(i * 2.7)) * 0.6;
                return (
                  <span
                    key={i}
                    style={{
                      height: `${active ? 5 + t.amplitude * 49 * envelope * variation : 4 + Math.abs(Math.sin(i * 1.8)) * 7 * envelope}px`,
                    }}
                  />
                );
              })}
            </div>
            <button
              className={`mic-button ${t.phase === "listening" ? "recording" : ""} ${busy ? "busy" : ""}`}
              onClick={() => void (active ? t.stop() : t.start())}
              disabled={t.phase === "stopping"}
              aria-label={
                t.phase === "stopping"
                  ? "Finishing translation"
                  : connecting
                    ? "Cancel connection"
                    : active
                      ? "Stop speaking"
                      : t.phase === "error"
                        ? "Try again"
                        : "Start speaking"
              }
            >
              {busy ? (
                <span className="spinner" />
              ) : t.phase === "listening" ? (
                <span className="stop-symbol" />
              ) : (
                <Icon name="mic" size={29} />
              )}
            </button>
            <p className="studio-status" role="status" aria-live="polite">
              {status}
            </p>
            <p className="studio-hint">
              {t.phase === "waking"
                ? "The free server is waking up. This can take about a minute."
                : connecting
                  ? "You can cancel while the server connects."
                  : t.phase === "stopping"
                    ? "Microphone off. Waiting for the final translation."
                    : t.phase === "listening"
                      ? t.playing
                        ? "Listen to the translation, then speak again."
                        : "Speak a sentence, then pause. Tap the square to finish."
                      : "Tap the microphone to start a conversation."}
            </p>
            <div className="studio-bottom">
              <span>
                <Icon name="headphones" size={14} /> Headphones recommended
              </span>
              <span>
                {active
                  ? `${t.characters} / ${t.characterLimit} voice characters`
                  : "3-minute demo sessions"}
              </span>
            </div>
          </div>
          {t.message && (
            <div
              className={`notice ${t.phase === "error" ? "notice-error" : ""}`}
              role={t.phase === "error" ? "alert" : "status"}
            >
              <span aria-hidden="true">{t.phase === "error" ? "!" : "i"}</span>
              <p>{t.message}</p>
            </div>
          )}

          <div className="transcript-toolbar">
            <div>
              <h2>Your conversation</h2>
              <span className="conversation-count">
                {t.transcripts.length
                  ? `${t.transcripts.length} ${t.transcripts.length === 1 ? "translation" : "translations"}`
                  : "Words will appear here"}
              </span>
            </div>
            <div className="transcript-actions">
              <button
                onClick={() => void copyTranscript()}
                disabled={!t.transcripts.length}
                aria-label="Copy conversation"
              >
                {copied ? "Copied" : "Copy text"}
              </button>
              <button
                className="clear-button"
                onClick={t.clear}
                disabled={active || !t.transcripts.length}
                aria-label="Clear conversation"
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>
          <div className="caption-headings">
            <span>
              <span className="panel-dot source-dot" />
              ORIGINAL <span>Auto-detected</span>
            </span>
            <span>
              <span className="panel-dot target-dot" />
              TRANSLATION <span>{LANGUAGES[language].native}</span>
            </span>
          </div>
          <div
            className="caption-feed"
            role="log"
            aria-label="Bilingual conversation"
            aria-live="polite"
            aria-relevant="additions"
          >
            {t.transcripts.length === 0 ? (
              <div className="caption-pair empty-pair">
                <div>
                  <span className="empty-caption-icon">
                    <Icon name="mic" size={21} />
                  </span>
                  <p>A thought, in your own words.</p>
                  <span>Your speech will appear here as you talk.</span>
                </div>
                <div>
                  <span className="empty-caption-icon teal">
                    <Icon name="globe" size={21} />
                  </span>
                  <p>The same thought, a little further.</p>
                  <span>
                    Your translation will appear here, and play aloud.
                  </span>
                </div>
              </div>
            ) : (
              t.transcripts.map((entry, index) => (
                <div className="caption-pair" key={entry.id}>
                  <div>
                    <span className="caption-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p dir="auto">{entry.source_text}</p>
                  </div>
                  <div className="translated-caption">
                    <p dir="auto" lang={LANGUAGES[entry.language]?.code}>
                      {entry.translated_text}
                    </p>
                    <button
                      className="replay-button"
                      onClick={() => void t.replay(entry)}
                      disabled={active || !entry.audio.length}
                      aria-label={`Replay translation ${index + 1}`}
                      title={
                        active
                          ? "Finish the session to replay"
                          : "Replay translated audio"
                      }
                    >
                      <Icon name="speaker" size={16} />
                      <span>Listen</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="privacy-note">
            <Icon name="lock" size={13} />
            <span>
              Audio is processed by Groq and ElevenLabs. This app saves no
              recordings on its server.
            </span>
          </div>
        </section>

        <section className="steps" aria-label="How to use Relay">
          <div>
            <span className="step-number">01</span>
            <p>
              <strong>Choose a language</strong>
              <span>Pick the language you want to hear.</span>
            </p>
          </div>
          <div>
            <span className="step-number">02</span>
            <p>
              <strong>Say what’s on your mind</strong>
              <span>Allow your mic, speak clearly, then pause.</span>
            </p>
          </div>
          <div>
            <span className="step-number">03</span>
            <p>
              <strong>Let the conversation travel</strong>
              <span>Read both captions and hear the translation.</span>
            </p>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          Made by{" "}
          <a
            href="https://github.com/Akgithub2028"
            target="_blank"
            rel="noreferrer"
          >
            Aayaann Kausar ↗
          </a>
        </span>
        <span>
          Non-commercial demo · Voice by{" "}
          <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">
            elevenlabs.io ↗
          </a>
        </span>
      </footer>
    </div>
  );
}
