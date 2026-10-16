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
}
const RATE = 48000;
const CONFIGURED_URL = process.env.NEXT_PUBLIC_WS_URL;

export function useTranslator(language: string) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState("listening");
  const [message, setMessage] = useState("");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const [characters, setCharacters] = useState(0);
  const [characterLimit, setCharacterLimit] = useState(600);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
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
  }, []);

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
        if (current()) ws.send(JSON.stringify({ target_language: language }));
      };
      let accepted = false;
      ws.onmessage = async (event) => {
        if (!current()) return;
        try {
          if (typeof event.data !== "string") {
            const data = event.data as ArrayBuffer;
            const id = currentTranscript.current;
            if (id !== null)
              setTranscripts((previous) =>
                previous.map((t) =>
                  t.id === id ? { ...t, audio: [...t.audio, data] } : t,
                ),
              );
            play(data);
            return;
          }
          const msg = JSON.parse(event.data);
          if (msg.type === "ready" && !accepted) {
            accepted = true;
            clearTimers();
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
              if (ws.readyState === WebSocket.OPEN && !sources.current.size) {
                if (ws.bufferedAmount > 192000) {
                  fail(
                    "Your connection is falling behind. Please reconnect and try again.",
                  );
                  return;
                }
                ws.send(audio.data);
              }
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
          } else if (msg.type === "transcript") {
            const id = nextId.current++;
            currentTranscript.current = id;
            setTranscripts((previous) => [
              ...previous.slice(-19),
              {
                id,
                source_text: msg.source_text,
                translated_text: msg.translated_text,
                language,
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
      ) return;
      stopPlayback();
      for (const chunk of transcript.audio) play(chunk);
    } catch {
      if (request === generation.current) setMessage("Audio playback could not start. Please try again.");
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
    start,
    stop,
    replay,
    clear,
  };
}
