"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Distribution = {
  samples: number;
  p50_ms: number;
  p95_ms: number;
  latest_ms: number;
};
type Provider = {
  status: string;
  configured: boolean;
  model: string;
  successes: number;
  failures: number;
  last_success: string | null;
  last_error: string | null;
  last_error_category: string | null;
};
type Metrics = {
  updated_at: string;
  started_at: string;
  uptime_seconds: number;
  retention: string;
  counts: Record<string, number>;
  capacity: {
    active_sessions: number;
    max_sessions: number;
    requests_last_minute: number;
    requests_per_minute_limit: number;
    daily_characters_used: number;
    daily_character_limit: number;
    session_seconds: number;
    session_characters: number;
  };
  providers: Record<string, Provider>;
  latency: Record<string, Distribution>;
  recent_errors: {
    at: string;
    stage: string;
    category: string;
    status_code: number | null;
  }[];
};
const CONFIGURED_URL = process.env.NEXT_PUBLIC_WS_URL;
const STAGES: Record<string, string> = {
  stt: "Speech recognition",
  translation: "Translation",
  tts: "Voice synthesis",
};
const STAGE_KEYS: Record<string, string> = {
  stt: "stt_ms",
  translation: "translation_ms",
  tts: "tts_first_byte_ms",
};
const ms = (value: number | undefined) =>
  value === undefined ? "—" : `${Math.round(value).toLocaleString()} ms`;
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not observed";
const duration = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;

export default function StatusPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState("Checking");
  const [ready, setReady] = useState("Checking");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastReceived, setLastReceived] = useState(0);
  const [now, setNow] = useState(0);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    async function check() {
      if (disposed || document.hidden || pending) return;
      pending = true;
      setRefreshing(true);
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 14000);
      try {
        const endpoint =
          CONFIGURED_URL ||
          (["localhost", "127.0.0.1"].includes(location.hostname)
            ? "ws://localhost:8000/ws/translate"
            : "");
        if (!endpoint) throw new Error("Backend URL is not configured.");
        const base = new URL(endpoint);
        base.protocol = base.protocol === "wss:" ? "https:" : "http:";
        base.search = "";
        const responses = await Promise.allSettled(
          ["health", "ready", "metrics"].map(async (path) => {
            const url = new URL(base);
            url.pathname = `/${path}`;
            const response = await fetch(url, {
              cache: "no-store",
              signal: controller!.signal,
            });
            return { ok: response.ok, data: await response.json() };
          }),
        );
        if (disposed) return;
        const [live, configured, aggregate] = responses;
        setHealth(
          live.status === "fulfilled" &&
            live.value.ok &&
            live.value.data.status === "ok"
            ? "Responding"
            : "Unavailable",
        );
        setReady(
          configured.status === "fulfilled" &&
            configured.value.ok &&
            configured.value.data.status === "ready"
            ? "Configured"
            : "Not ready",
        );
        if (
          aggregate.status === "fulfilled" &&
          aggregate.value.ok &&
          aggregate.value.data.providers
        ) {
          setMetrics(aggregate.value.data);
          setLastReceived(Date.now());
        }
        setError(
          responses.some((r) => r.status === "rejected" || !r.value.ok)
            ? "Some checks failed. The free server may be waking up; monitoring will retry while this page is visible."
            : "",
        );
        setNow(Date.now());
      } catch {
        if (!disposed) {
          setError(
            "Could not reach the backend. Checks will retry while this page is visible.",
          );
          setHealth("Unavailable");
          setReady("Unknown");
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!disposed) setRefreshing(false);
      }
    }
    refreshRef.current = () => void check();
    const visibility = () => {
      setPaused(document.hidden);
      setNow(Date.now());
      if (document.hidden) controller?.abort();
      else void check();
    };
    const interval = setInterval(() => void check(), 15000);
    const clock = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    document.addEventListener("visibilitychange", visibility);
    void check();
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility);
      refreshRef.current = () => {};
    };
  }, []);

  const stale = lastReceived > 0 && now - lastReceived > 45000;
  const completed = metrics?.counts.utterances_completed || 0;
  const failed = metrics?.counts.utterances_failed || 0;
  const outcomes = completed + failed;
  const hasDegraded =
    metrics &&
    Object.values(metrics.providers).some(
      (p) => p.status === "degraded" || !p.configured,
    );
  const operational =
    health === "Responding" && ready === "Configured" && !stale && !error;
  const overall = paused
    ? "Monitoring paused"
    : operational
      ? hasDegraded
        ? "Backend responding · provider issue observed"
        : "Backend responding"
      : health === "Checking"
        ? "Checking backend"
        : "Attention needed";
  const cap = metrics?.capacity;

  return (
    <div className="app-shell status-shell">
      <a className="skip-link" href="#status">
        Skip to system metrics
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
        <Link className="source-link" href="/">
          ← Back to translator
        </Link>
      </header>
      <main id="status">
        <section className="intro">
          <div>
            <p className="eyebrow">LIVE SYSTEM OBSERVABILITY</p>
            <h1>
              Every turn, <span>accounted for.</span>
            </h1>
            <p className="intro-description">
              Real measurements from the running translation backend. No
              simulated traffic.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={refresh}
            disabled={refreshing || paused}
          >
            {refreshing ? "Checking…" : "Refresh now"}
          </button>
        </section>
        <section
          className={`system-banner ${operational && !hasDegraded ? "system-ok" : ""}`}
          role="status"
        >
          <div>
            <span className="health-dot" />
            <strong>{overall}</strong>
          </div>
          <span>
            {lastReceived
              ? `Metrics received ${Math.max(0, Math.floor((now - lastReceived) / 1000))}s ago${stale ? " · stale" : ""}`
              : "Waiting for first measurement"}
          </span>
        </section>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="metric-grid">
          <Metric
            label="Active sessions"
            value={cap ? `${cap.active_sessions} / ${cap.max_sessions}` : "—"}
            detail={
              cap
                ? `${Math.max(0, cap.max_sessions - cap.active_sessions)} available slots`
                : "Waiting for backend"
            }
          />
          <Metric
            label="Completed translations"
            value={metrics ? String(completed) : "—"}
            detail="Since this backend process started"
          />
          <Metric
            label="Successful outcomes"
            value={
              outcomes ? `${((completed / outcomes) * 100).toFixed(1)}%` : "—"
            }
            detail={
              outcomes
                ? `${completed} completed · ${failed} failed`
                : "No completed or failed utterances yet"
            }
          />
          <Metric
            label="Median speech → first audio"
            value={ms(metrics?.latency.speech_to_first_audio_ms?.p50_ms)}
            detail={
              metrics?.latency.speech_to_first_audio_ms
                ? `${metrics.latency.speech_to_first_audio_ms.samples} server timing samples`
                : "Measured after real speech"
            }
          />
        </div>
        <div className="status-columns">
          <section className="status-panel">
            <div className="panel-title">
              <h2>Backend &amp; provider observations</h2>
              <span className="subtle-label">Live checks + real requests</span>
            </div>
            <div className="health-check-row">
              <span>HTTP liveness</span>
              <strong>{health}</strong>
            </div>
            <div className="health-check-row">
              <span>Required configuration</span>
              <strong>{ready}</strong>
            </div>
            {Object.entries(STAGES).map(([key, label]) => {
              const p = metrics?.providers[key];
              return (
                <div className="provider-row" key={key}>
                  <div>
                    <strong>{label}</strong>
                    <span className="model-name">
                      {p?.model || "Awaiting configuration"}
                    </span>
                  </div>
                  <span
                    className={`provider-state ${p?.status === "observed_ok" ? "observed-ok" : p?.status === "degraded" || p?.status === "unconfigured" ? "observed-error" : ""}`}
                  >
                    {p?.status === "observed_ok"
                      ? "Success observed"
                      : p?.status === "degraded"
                        ? "Error observed"
                        : p?.status === "unconfigured"
                          ? "Not configured"
                          : "Not yet observed"}
                  </span>
                  <p>
                    Last success: {when(p?.last_success || null)}
                    {p
                      ? ` · ${p.successes} successful stage responses · ${p.failures} errors`
                      : ""}
                  </p>
                </div>
              );
            })}
            <p className="panel-note">
              A configured key is not proof of upstream availability. Provider
              status changes only after an actual translation request; these
              checks spend no AI quota.
            </p>
          </section>
          <section className="status-panel">
            <div className="panel-title">
              <h2>Free demo safeguards</h2>
              <span className="subtle-label">Enforced by the server</span>
            </div>
            <div className="budget-row">
              <span>Voice characters used today</span>
              <strong>
                {cap
                  ? `${cap.daily_characters_used.toLocaleString()} / ${cap.daily_character_limit.toLocaleString()}`
                  : "—"}
              </strong>
            </div>
            <progress
              aria-label="Daily demo voice character budget used"
              max={cap?.daily_character_limit || 1}
              value={cap?.daily_characters_used || 0}
            />
            <div className="budget-row">
              <span>Pipeline requests in the last minute</span>
              <strong>
                {cap
                  ? `${cap.requests_last_minute} / ${cap.requests_per_minute_limit}`
                  : "—"}
              </strong>
            </div>
            <progress
              aria-label="Pipeline requests per minute"
              max={cap?.requests_per_minute_limit || 1}
              value={cap?.requests_last_minute || 0}
            />
            <div className="health-check-row">
              <span>Session limit</span>
              <strong>
                {cap
                  ? `${duration(cap.session_seconds)} · ${cap.session_characters} voice characters`
                  : "—"}
              </strong>
            </div>
            <div className="health-check-row">
              <span>Backend uptime</span>
              <strong>
                {metrics ? duration(metrics.uptime_seconds) : "—"}
              </strong>
            </div>
            <div className="health-check-row">
              <span>Audio sent to browsers</span>
              <strong>
                {metrics
                  ? `${(metrics.counts.audio_bytes_sent / 1024).toFixed(1)} KiB`
                  : "—"}
              </strong>
            </div>
            <p className="panel-note">
              These are process-local demo budgets, not the provider’s monthly
              billing balance. Counters reset when Render sleeps, restarts or
              redeploys. Provider Free quotas remain authoritative.
            </p>
          </section>
        </div>
        <section className="status-panel latency-panel">
          <div className="panel-title">
            <h2>Where the time goes</h2>
            <span className="subtle-label">
              Latest 120 samples per metric · milliseconds
            </span>
          </div>
          <div
            className="table-scroll"
            role="region"
            aria-label="Scrollable latency measurements"
            tabIndex={0}
          >
            <table className="metrics-table">
              <caption className="sr-only">
                Observed server latency distributions by pipeline stage
              </caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Latest</th>
                  <th scope="col">Median (p50)</th>
                  <th scope="col">p95</th>
                  <th scope="col">Samples</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Endpoint wait", "endpoint_ms"],
                  ["Queue wait", "queue_ms"],
                  ...Object.entries(STAGES).map(([key, label]) => [
                    key === "tts" ? "Voice first byte" : label,
                    STAGE_KEYS[key],
                  ]),
                  ["Speech received → first audio", "speech_to_first_audio_ms"],
                ].map(([label, key]) => {
                  const row = metrics?.latency[key];
                  return (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>{ms(row?.latest_ms)}</td>
                      <td>{ms(row?.p50_ms)}</td>
                      <td>{ms(row?.p95_ms)}</td>
                      <td>{row?.samples ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="panel-note">
            Server timings use one monotonic clock and exclude browser
            transport/playback. Cold-start connection time is shown separately
            in the translator. p95 uses nearest rank; small sample counts
            provide limited evidence.
          </p>
        </section>
        <div className="status-columns">
          <section className="status-panel">
            <div className="panel-title">
              <h2>Conversation lifecycle</h2>
              <span className="subtle-label">Since process start</span>
            </div>
            <dl className="lifecycle-list">
              {[
                ["Sessions accepted", "sessions_started"],
                ["Sessions ended", "sessions_ended"],
                ["Sessions rejected", "sessions_rejected"],
                ["Utterances started", "utterances_started"],
                ["Completed with audio", "utterances_completed"],
                ["Failed utterances", "utterances_failed"],
                ["Interrupted / discarded", "utterances_interrupted"],
                ["Empty speech filtered", "utterances_empty"],
                ["Speaker changes / interruptions", "interruptions"],
              ].map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{metrics?.counts[key] ?? "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="panel-note">
              Success rate includes completed and failed utterances only; empty
              and intentionally interrupted work is excluded.
            </p>
          </section>
          <section className="status-panel">
            <div className="panel-title">
              <h2>Recent provider errors</h2>
              <span className="subtle-label">Latest 20 · no user content</span>
            </div>
            {metrics?.recent_errors.length ? (
              <ul className="error-events">
                {metrics.recent_errors.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <strong>
                      {STAGES[e.stage] || e.stage} · {e.category}
                      {e.status_code ? ` (${e.status_code})` : ""}
                    </strong>
                    <time dateTime={e.at}>{when(e.at)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-events">
                {metrics
                  ? "No provider errors recorded in this process."
                  : "Waiting for backend measurements."}
              </p>
            )}
            <p className="panel-note">
              Logs and metrics contain operational data only. No transcripts,
              recordings, API credentials or visitor addresses are shown.
            </p>
          </section>
        </div>
        <p className="monitor-footnote">
          Refreshes every 15 seconds while this page is visible. Closing or
          hiding it pauses checks. Measurements began{" "}
          {metrics
            ? when(metrics.started_at)
            : "when the backend process started"}
          ; this is live process monitoring, not a historical uptime SLA.
        </p>
      </main>
      <footer className="site-footer">
        <span>Relay · system observability</span>
        <span>
          Vercel Hobby + Render Free · no additional monitoring service
        </span>
      </footer>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="metric-card">
      <h2>{label}</h2>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
