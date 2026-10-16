"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Phase =
  "idle" | "connecting" | "waking" | "listening" | "stopping" | "error";
export interface Transcript {
  id: number;
  source_text: string;
  translated_text: string;
  language: string;
  audio: ArrayBuffer[];
  sourceLanguage: string;
  turnId: number;
  utteranceId: number;
  interrupted?: boolean;
  timings?: Record<string, number>;
}
const RATE = 48000;
const CONFIGURED_URL = process.env.NEXT_PUBLIC_WS_URL;
type AudioFrame = { data: ArrayBuffer; at: number };

export function useTranslator(
  language: string,
  sourceLanguage: string = "English",
) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState("listening");
  const [message, setMessage] = useState("");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const [characters, setCharacters] = useState(0);
  const [characterLimit, setCharacterLimit] = useState(600);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [connectionMs, setConnectionMs] = useState<number | null>(null);
  const [latestTimings, setLatestTimings] = useState<Record<string, number>>(
    {},
  );
  const socket = useRef<WebSocket | null>(null);
  const context = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const input = useRef<MediaStreamAudioSourceNode | null>(null);
  const worklet = useRef<AudioWorkletNode | null>(null);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const nextPlay = useRef(0);
  const generation = useRef(0);
  const currentTranscript = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abort = useRef<AbortController | null>(null);
  const flushResolve = useRef<(() => void) | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const startedAt = useRef(0);
  const nextId = useRef(0);
  const turn = useRef(0);
  const direction = useRef({ source: sourceLanguage, target: language });
  const turnPending = useRef(false);
  const nextTurnAt = useRef(0);
  const pendingAudio = useRef<AudioFrame[]>([]);
  const recentAudio = useRef<AudioFrame[]>([]);
  const lastSpeechAt = useRef(0);
  const utterances = useRef(
    new Map<number, { rowId?: number; speechEnd: number; received: boolean }>(),
  );
  const turnAck = useRef<Promise<boolean> | null>(null);
  const resolveTurnAck = useRef<((ok: boolean) => void) | null>(null);

  const changePhase = useCallback((value: Phase) => {
    phaseRef.current = value;
    setPhase(value);
  }, []);

  const stopCapture = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    input.current?.disconnect();
    input.current = null;
    worklet.current?.disconnect();
    if (worklet.current) worklet.current.port.onmessage = null;
    worklet.current = null;
    setAmplitude(0);
  }, []);

  const stopPlayback = useCallback(() => {
    sources.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    });
    sources.current.clear();
    nextPlay.current = 0;
    setPlaying(false);
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const dispose = useCallback(
    (closePlayback: boolean) => {
      generation.current++;
      turnPending.current = false;
      nextTurnAt.current = 0;
      resolveTurnAck.current?.(false);
      resolveTurnAck.current = null;
      setSwitching(false);
      recentAudio.current = [];
      pendingAudio.current = [];
      clearTimers();
      abort.current?.abort();
      abort.current = null;
      flushResolve.current?.();
      flushResolve.current = null;
      stopCapture();
      if (socket.current) {
        socket.current.onclose = null;
        socket.current.onerror = null;
        socket.current.onmessage = null;
        socket.current.close();
        socket.current = null;
      }
      if (closePlayback) {
        stopPlayback();
        void context.current?.close();
        context.current = null;
      } else if (
        !sources.current.size &&
        context.current?.state === "running"
      ) {
        void context.current.suspend();
      }
    },
    [clearTimers, stopCapture, stopPlayback],
  );

  useEffect(() => () => dispose(true), [dispose]);

  useEffect(() => {
    if (phase !== "listening" && phase !== "stopping") return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [phase]);

  const fail = useCallback(
    (text: string) => {
      dispose(false);
      setMessage(text);
      changePhase("error");
    },
    [dispose, changePhase],
  );

  const play = useCallback((data: ArrayBuffer) => {
    const ctx = context.current;
    if (!ctx || ctx.state === "closed" || data.byteLength < 2) return;
    if (data.byteLength % 2)
      throw new Error("The server returned incomplete audio.");
    const pcm = new Int16Array(data);
    const floats = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) floats[i] = pcm[i] / 32768;
    const buffer = ctx.createBuffer(1, floats.length, RATE);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    sources.current.add(source);
    setPlaying(true);
    source.onended = () => {
      source.disconnect();
      sources.current.delete(source);
      if (sources.current.size === 0) {
        setPlaying(false);
        if (
          ["idle", "error"].includes(phaseRef.current) &&
          ctx.state === "running"
        )
          void ctx.suspend();
      }
    };
    const start = Math.max(nextPlay.current, ctx.currentTime + 0.025);
    source.start(start);
    nextPlay.current = start + buffer.duration;
    return (start - ctx.currentTime) * 1000;
  }, []);

  function sendPcm(data: ArrayBuffer, capturedAt = performance.now()) {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 192000) {
      fail(
        "Your connection is falling behind. Please reconnect and try again.",
      );
      return;
    }
    const values = new Int16Array(data);
    let sum = 0;
    for (const value of values) sum += value * value;
    if (Math.sqrt(sum / values.length) >= 700)
      lastSpeechAt.current = capturedAt;
    const packet = new ArrayBuffer(data.byteLength + 12);
    const header = new DataView(packet);
    header.setUint32(0, turn.current);
    header.setFloat64(4, lastSpeechAt.current);
    new Uint8Array(packet, 12).set(new Uint8Array(data));
    ws.send(packet);
  }

  async function start() {
    if (!["idle", "error"].includes(phaseRef.current)) return;
    dispose(true);
    const session = generation.current;
    const current = () => session === generation.current;
    changePhase("connecting");
    setMessage("");
    setCharacters(0);
    setElapsed(0);
    setStage("listening");
    currentTranscript.current = null;
    utterances.current.clear();
    turn.current = 0;
    direction.current = { source: sourceLanguage, target: language };
    lastSpeechAt.current = 0;
    setLatestTimings({});
    setConnectionMs(null);
    const connectionStarted = performance.now();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        throw new Error(
          "Your browser needs microphone support and a secure HTTPS connection.",
        );
      }
      const url =
        CONFIGURED_URL ||
        (["localhost", "127.0.0.1"].includes(window.location.hostname)
          ? "ws://localhost:8000/ws/translate"
          : "");
      if (!url)
        throw new Error(
          "The translation server is not configured yet. Please try again later.",
        );
      const target = new URL(url);
      if (
        !["ws:", "wss:"].includes(target.protocol) ||
        (location.protocol === "https:" && target.protocol !== "wss:")
      ) {
        throw new Error(
          "The translation server needs a secure WebSocket connection.",
        );
      }
      // Resume audio during the button gesture, before the cold-start/network wait.
      const ctx = new AudioContext({ sampleRate: RATE });
      context.current = ctx;
      await ctx.resume();
      if (!current()) return;
      if (ctx.sampleRate !== RATE)
        throw new Error(
          "This browser cannot capture audio at the required sample rate.",
        );
      const controller = new AbortController();
      abort.current = controller;
      timers.current.push(
        setTimeout(() => {
          if (current()) changePhase("waking");
        }, 3000),
      );
      timers.current.push(
        setTimeout(() => {
          if (current())
            fail(
              "The server took too long to respond. Please try connecting again.",
            );
        }, 90000),
      );
      const health = new URL(target);
      health.protocol = target.protocol === "wss:" ? "https:" : "http:";
      health.pathname = "/ready";
      health.search = "";
      const response = await fetch(health, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!current()) return;
      if (!response.ok)
        throw new Error(
          "The translation server is not ready yet. Please try again shortly.",
        );
      const ws = new WebSocket(target);
      socket.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (current())
          ws.send(
            JSON.stringify({
              protocol: 2,
              source_language: sourceLanguage,
              target_language: language,
            }),
          );
      };
      let accepted = false;
      ws.onmessage = async (event) => {
        if (!current()) return;
        try {
          if (typeof event.data !== "string") {
            const packet = event.data as ArrayBuffer;
            if (packet.byteLength < 10)
              throw new Error("The server returned incomplete audio.");
            const header = new DataView(packet);
            if (header.getUint32(0) !== turn.current || turnPending.current)
              return;
            const utteranceId = header.getUint32(4);
            const record = utterances.current.get(utteranceId);
            if (!record || record.rowId === undefined) return;
            const data = packet.slice(8);
            const received = performance.now();
            const delay = play(data) || 0;
            const clientTiming: Record<string, number> =
              !record.received && record.speechEnd > 0
                ? {
                    browser_first_audio_ms: Math.max(
                      0,
                      received - record.speechEnd,
                    ),
                    browser_scheduled_playback_ms: Math.max(
                      0,
                      received + delay - record.speechEnd,
                    ),
                  }
                : {};
            record.received = true;
            if (Object.keys(clientTiming).length)
              setLatestTimings((previous) => ({
                ...previous,
                ...clientTiming,
              }));
            if (record.rowId !== undefined)
              setTranscripts((previous) =>
                previous.map((t) =>
                  t.id === record.rowId
                    ? {
                        ...t,
                        audio: [...t.audio, data],
                        timings: { ...t.timings, ...clientTiming },
                      }
                    : t,
                ),
              );
            return;
          }
          const msg = JSON.parse(event.data);
          if (typeof msg.turn_id === "number" && msg.turn_id !== turn.current)
            return;
          if (
            turnPending.current &&
            !["turn_ready", "error", "info"].includes(msg.type)
          )
            return;
          if (msg.type === "ready" && !accepted) {
            if (msg.protocol !== 2)
              throw new Error(
                "The server is updating. Please reconnect shortly.",
              );
            accepted = true;
            clearTimers();
            setConnectionMs(performance.now() - connectionStarted);
            setCharacterLimit(msg.character_limit || 600);
            setMessage("Allow microphone access to start your conversation.");
            const media = await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                sampleRate: RATE,
                echoCancellation: true,
                noiseSuppression: true,
              },
            });
            if (!current()) {
              media.getTracks().forEach((track) => track.stop());
              return;
            }
            stream.current = media;
            media.getAudioTracks()[0].onended = () => {
              if (current() && phaseRef.current === "listening")
                fail(
                  "Your microphone disconnected. Reconnect it and try again.",
                );
            };
            await ctx.audioWorklet.addModule("/pcm-processor.js");
            if (!current()) return;
            const node = new AudioWorkletNode(ctx, "pcm-processor");
            worklet.current = node;
            let lastVisual = 0;
            node.port.onmessage = (
              audio: MessageEvent<ArrayBuffer | { type: string }>,
            ) => {
              if (!current()) return;
              if (!(audio.data instanceof ArrayBuffer)) {
                if (audio.data.type === "flushed") flushResolve.current?.();
                return;
              }
              const frame = { data: audio.data, at: performance.now() };
              recentAudio.current = [...recentAudio.current.slice(-9), frame];
              if (turnPending.current) {
                if (pendingAudio.current.length >= 50) {
                  fail("The speaker switch took too long. Please reconnect.");
                  return;
                }
                pendingAudio.current.push(frame);
              } else if (!sources.current.size) sendPcm(audio.data, frame.at);
              const now = performance.now();
              if (now - lastVisual > 66) {
                lastVisual = now;
                const values = new Int16Array(audio.data);
                let sum = 0;
                for (const value of values) sum += value * value;
                setAmplitude(
                  Math.min(1, Math.sqrt(sum / values.length) / 7000),
                );
              }
            };
            const source = ctx.createMediaStreamSource(media);
            input.current = source;
            source.connect(node);
            // Worklet outputs silence; connecting it keeps processing reliable across browsers.
            node.connect(ctx.destination);
            startedAt.current = Date.now();
            setMessage("");
            changePhase("listening");
          } else if (msg.type === "turn_ready") {
            turnPending.current = false;
            const acknowledgedTurn = turn.current;
            timers.current.push(
              setTimeout(
                () => {
                  if (current() && acknowledgedTurn === turn.current)
                    setSwitching(false);
                },
                Math.max(0, nextTurnAt.current - performance.now()),
              ),
            );
            setStage("listening");
            const buffered = pendingAudio.current;
            pendingAudio.current = [];
            for (const frame of buffered) sendPcm(frame.data, frame.at);
            resolveTurnAck.current?.(true);
            resolveTurnAck.current = null;
            setMessage(
              `Now listening in ${msg.source_language}. Earlier captions remain available.`,
            );
          } else if (msg.type === "utterance") {
            utterances.current.set(msg.utterance_id, {
              speechEnd: msg.speech_end_ms,
              received: false,
            });
          } else if (msg.type === "metrics") {
            const record = utterances.current.get(msg.utterance_id);
            setLatestTimings(msg.timings);
            if (record?.rowId !== undefined)
              setTranscripts((previous) =>
                previous.map((t) =>
                  t.id === record.rowId
                    ? { ...t, timings: { ...t.timings, ...msg.timings } }
                    : t,
                ),
              );
          } else if (msg.type === "transcript") {
            const id = nextId.current++;
            currentTranscript.current = id;
            const record = utterances.current.get(msg.utterance_id) || {
              speechEnd: 0,
              received: false,
            };
            record.rowId = id;
            utterances.current.set(msg.utterance_id, record);
            setTranscripts((previous) => [
              ...previous.slice(-19),
              {
                id,
                source_text: msg.source_text,
                translated_text: msg.translated_text,
                language: msg.target_language,
                sourceLanguage: msg.source_language || "Auto-detected",
                turnId: msg.turn_id,
                utteranceId: msg.utterance_id,
                audio: [],
              },
            ]);
          } else if (msg.type === "status") {
            setStage(msg.stage);
          } else if (msg.type === "usage") {
            setCharacters(msg.characters);
          } else if (msg.type === "stopped") {
            dispose(false);
            changePhase("idle");
            setStage("listening");
            setMessage(
              "Session complete. Your translations are ready to replay.",
            );
          } else if (msg.type === "error") {
            fail(msg.message);
          } else if (msg.type === "info") {
            dispose(false);
            changePhase("idle");
            setMessage(msg.message);
          }
        } catch (error) {
          if (!current()) return;
          const name = error instanceof DOMException ? error.name : "";
          fail(
            name === "NotAllowedError"
              ? "Microphone access was denied. Allow it in your browser settings, then try again."
              : name === "NotFoundError"
                ? "No microphone was found. Connect one and try again."
                : error instanceof Error
                  ? error.message
                  : "Something interrupted the session. Please try again.",
          );
        }
      };
      ws.onerror = () => {
        if (current())
          fail(
            "Could not connect to the translation server. Please try again.",
          );
      };
      ws.onclose = () => {
        if (current())
          fail(
            "The connection ended. Your captions are saved here; reconnect to continue.",
          );
      };
    } catch (error) {
      if (current())
        fail(
          error instanceof Error
            ? error.message
            : "Could not start the translation session.",
        );
    }
  }

  async function stop() {
    if (["connecting", "waking"].includes(phaseRef.current)) {
      dispose(true);
      changePhase("idle");
      setMessage("");
      return;
    }
    if (phaseRef.current !== "listening") return;
    changePhase("stopping");
    stream.current?.getTracks().forEach((track) => track.stop());
    const session = generation.current;
    const node = worklet.current;
    if (node) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        flushResolve.current = () => {
          clearTimeout(timer);
          resolve();
        };
        node.port.postMessage("flush");
      });
    }
    if (session !== generation.current) return;
    if (turnPending.current && turnAck.current) {
      await turnAck.current;
      if (session !== generation.current) return;
    }
    flushResolve.current = null;
    stopCapture();
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ action: "stop" }));
      timers.current.push(
        setTimeout(() => {
          if (session === generation.current)
            fail(
              "The final translation took too long. Please start a new session.",
            );
        }, 70000),
      );
    } else {
      fail("The connection ended before the final translation could finish.");
    }
  }

  function interrupt(
    source = direction.current.source,
    target = direction.current.target,
  ) {
    const ws = socket.current;
    if (
      phaseRef.current !== "listening" ||
      turnPending.current ||
      performance.now() < nextTurnAt.current ||
      ws?.readyState !== WebSocket.OPEN
    )
      return false;
    const oldTurn = turn.current;
    const wasPlaying = sources.current.size > 0;
    nextTurnAt.current = performance.now() + 350;
    stopPlayback();
    turn.current++;
    const requestedTurn = turn.current;
    direction.current = { source, target };
    turnPending.current = true;
    setSwitching(true);
    setLatestTimings({});
    lastSpeechAt.current = 0;
    pendingAudio.current = recentAudio.current.slice(-10);
    recentAudio.current = [];
    setTranscripts((previous) =>
      previous.map((t) =>
        wasPlaying && t.turnId === oldTurn && t.id === currentTranscript.current
          ? { ...t, interrupted: true }
          : t,
      ),
    );
    currentTranscript.current = null;
    const session = generation.current;
    turnAck.current = new Promise((resolve) => {
      resolveTurnAck.current = resolve;
    });
    ws.send(
      JSON.stringify({
        action: "interrupt",
        turn_id: turn.current,
        source_language: source,
        target_language: target,
      }),
    );
    timers.current.push(
      setTimeout(() => {
        if (
          session === generation.current &&
          requestedTurn === turn.current &&
          turnPending.current
        )
          fail("The speaker switch could not be confirmed. Please reconnect.");
      }, 5000),
    );
    return true;
  }

  async function replay(transcript: Transcript) {
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") return;
    const request = ++generation.current;
    try {
      if (!context.current || context.current.state === "closed")
        context.current = new AudioContext({ sampleRate: RATE });
      const playbackContext = context.current;
      await playbackContext.resume();
      if (
        request !== generation.current ||
        context.current !== playbackContext ||
        !["idle", "error"].includes(phaseRef.current)
      )
        return;
      stopPlayback();
      for (const chunk of transcript.audio) play(chunk);
    } catch {
      if (request === generation.current)
        setMessage("Audio playback could not start. Please try again.");
    }
  }

  function clear() {
    generation.current++;
    stopPlayback();
    setTranscripts([]);
    setMessage("");
  }

  return {
    phase,
    stage,
    message,
    transcripts,
    amplitude,
    characters,
    characterLimit,
    elapsed,
    playing,
    switching,
    connectionMs,
    latestTimings,
    interrupt,
    start,
    stop,
    replay,
    clear,
  };
}
