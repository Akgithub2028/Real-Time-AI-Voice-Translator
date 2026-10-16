import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3100";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
  ],
});
const failures = [];
let checks = 0;
async function check(name, run) {
  try {
    await run();
    checks++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.error("FAIL", name, e.message);
  }
}

async function setup({
  denied = false,
  delayPermission = 0,
  slowHealth = false,
  ackDelay = 0,
} = {}) {
  const context = await browser.newContext({
    permissions: ["microphone", "clipboard-write"],
  });
  await context.addInitScript(
    ({ denied, delayPermission }) => {
      window.__tracks = [];
      window.__permissionCalls = 0;
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (...args) => {
        window.__permissionCalls++;
        if (denied)
          throw new DOMException("Permission denied", "NotAllowedError");
        if (delayPermission)
          await new Promise((resolve) => setTimeout(resolve, delayPermission));
        const stream = await getUserMedia(...args);
        window.__tracks.push(...stream.getTracks());
        return stream;
      };
    },
    { denied, delayPermission },
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/ready", async (route) => {
    if (slowHealth) await new Promise((resolve) => setTimeout(resolve, 1800));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready" }),
    });
  });
  let packets = 0;
  let bytes = 0;
  let latestSocket;
  let turn = 0;
  let speechEnd = 0;
  let protocol = 1;
  let sourceLanguage = "English";
  let targetLanguage = "Hindi";
  const controls = [];
  const turnPackets = [];
  const server = {
    send(event) {
      latestSocket.send(
        typeof event === "object" && !Buffer.isBuffer(event)
          ? JSON.stringify(event)
          : event,
      );
    },
    audio(id, seconds = 0.1, oldTurn = turn) {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(oldTurn, 0);
      header.writeUInt32BE(id, 4);
      latestSocket.send(
        Buffer.concat([header, Buffer.alloc(Math.round(96000 * seconds), 1)]),
      );
    },
    translate(id = 1, text = "नमस्ते दुनिया") {
      server.send({
        type: "utterance",
        turn_id: turn,
        utterance_id: id,
        speech_end_ms: speechEnd,
        source_language: sourceLanguage,
        target_language: targetLanguage,
      });
      server.send({
        type: "transcript",
        turn_id: turn,
        utterance_id: id,
        source_text: "Hello world",
        translated_text: text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
      });
      server.send({
        type: "metrics",
        turn_id: turn,
        utterance_id: id,
        timings: {
          stt_ms: 120,
          translation_ms: 80,
          tts_first_byte_ms: 210,
          queue_ms: 0,
          endpoint_ms: 600,
        },
      });
    },
    controls,
  };
  await page.routeWebSocket("**/ws/translate", (ws) => {
    latestSocket = ws;
    ws.onMessage((data) => {
      if (typeof data !== "string") {
        packets++;
        bytes += data.length - (protocol === 2 ? 12 : 0);
        if (protocol === 2) {
          speechEnd = data.readDoubleBE(4);
          turnPackets.push(data.readUInt32BE(0));
        }
        return;
      }
      const msg = JSON.parse(data);
      controls.push(msg);
      if (msg.action === "interrupt") {
        turn = msg.turn_id;
        sourceLanguage = msg.source_language;
        targetLanguage = msg.target_language;
        setTimeout(
          () =>
            server.send({
              type: "turn_ready",
              turn_id: turn,
              source_language: sourceLanguage,
              target_language: targetLanguage,
            }),
          ackDelay,
        );
      } else if (msg.target_language) {
        protocol = msg.protocol || 1;
        sourceLanguage = msg.source_language;
        targetLanguage = msg.target_language;
        server.send({
          type: "ready",
          protocol,
          turn_id: 0,
          source_language: sourceLanguage,
          target_language: targetLanguage,
          character_limit: 600,
        });
      }
      if (msg.action === "stop") {
        server.translate();
        server.audio(1);
        server.send({ type: "usage", turn_id: turn, characters: 12 });
        server.send({ type: "stopped" });
      }
    });
  });
  await page.goto(base);
  return {
    page,
    context,
    errors,
    server,
    stats: () => ({ packets, bytes, turnPackets }),
  };
}

try {
  await check(
    "dashboard displays measured metrics, sample counts and failed refresh honestly",
    async () => {
      const { page, context, errors } = await setup();
      let failed = false;
      await page.route("**/health", (route) =>
        route.fulfill({ json: { status: "ok" } }),
      );
      await page.route("**/metrics", (route) =>
        failed
          ? route.fulfill({ status: 503, json: { status: "unavailable" } })
          : route.fulfill({
              json: {
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                uptime_seconds: 32,
                counts: {
                  utterances_completed: 7,
                  utterances_failed: 1,
                  audio_bytes_sent: 2048,
                },
                capacity: {
                  active_sessions: 1,
                  max_sessions: 2,
                  requests_last_minute: 3,
                  requests_per_minute_limit: 15,
                  daily_characters_used: 150,
                  daily_character_limit: 1000,
                  session_seconds: 180,
                  session_characters: 600,
                },
                providers: Object.fromEntries(
                  ["stt", "translation", "tts"].map((key) => [
                    key,
                    {
                      status: "unobserved",
                      configured: true,
                      model: "configured-model",
                      successes: 0,
                      failures: 0,
                      last_success: null,
                    },
                  ]),
                ),
                latency: {
                  speech_to_first_audio_ms: {
                    samples: 7,
                    p50_ms: 1240,
                    p95_ms: 1620,
                    latest_ms: 1200,
                  },
                },
                recent_errors: [],
              },
            }),
      );
      await page.goto(`${base}/status`);
      await page.getByText("87.5%", { exact: true }).waitFor();
      await page
        .getByText("7 server timing samples", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByText("Not yet observed", { exact: true }).count(),
        3,
      );
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        if (process.env.SCREENSHOT_DIR)
          await page.screenshot({
            path: `${process.env.SCREENSHOT_DIR}/relay-status-${width}.png`,
            fullPage: true,
          });
      }
      failed = true;
      await page
        .getByRole("button", { name: "Refresh now", exact: true })
        .click();
      await page.locator(".notice[role=alert]").waitFor();
      await page.getByText("Attention needed", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "interrupt stops playback, rejects old audio, and switches language direction on the same socket",
    async () => {
      const { page, context, server, errors } = await setup();
      await page.addInitScript(() => {});
      await page.evaluate(() => {
        window.__audioStarts = 0;
        window.__audioStops = 0;
        const start = AudioBufferSourceNode.prototype.start;
        const stop = AudioBufferSourceNode.prototype.stop;
        AudioBufferSourceNode.prototype.start = function (...args) {
          window.__audioStarts++;
          return start.apply(this, args);
        };
        AudioBufferSourceNode.prototype.stop = function (...args) {
          window.__audioStops++;
          return stop.apply(this, args);
        };
      });
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .waitFor();
      await page.waitForTimeout(100);
      server.translate();
      server.audio(1, 3);
      await page.waitForFunction(() => window.__audioStarts > 0);
      await page
        .getByRole("button", { name: "Switch speaker", exact: true })
        .click();
      await page.waitForFunction(() => window.__audioStops > 0);
      const control = server.controls.find((x) => x.action === "interrupt");
      assert.equal(control.source_language, "Hindi");
      assert.equal(control.target_language, "English");
      const starts = await page.evaluate(() => window.__audioStarts);
      server.audio(1, 0.1, 0);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__audioStarts), starts);
      assert.equal(await page.getByLabel("YOU SPEAK").inputValue(), "Hindi");
      assert.equal(
        await page.getByLabel("TRANSLATE INTO").inputValue(),
        "English",
      );
      assert.equal(server.controls.filter((x) => x.protocol === 2).length, 1);
      assert.equal(
        await page.evaluate(() => window.__tracks[0].readyState),
        "live",
      );
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .click();
      await page
        .getByText("Session complete. Your translations are ready to replay.")
        .waitFor();
      assert.equal(
        await page.evaluate(() =>
          window.__tracks.every((t) => t.readyState === "ended"),
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "speaker acknowledgement retains buffered audio and Stop safely waits for it",
    async () => {
      const { page, context, server, stats, errors } = await setup({
        ackDelay: 250,
      });
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .waitFor();
      await page.waitForTimeout(350);
      await page
        .getByRole("button", { name: "Switch speaker", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "Switch speaker", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .click();
      await page
        .getByText("Session complete. Your translations are ready to replay.")
        .waitFor();
      assert.ok(
        stats().turnPackets.filter((turn) => turn === 1).length >= 10,
        "Pre-roll was lost while waiting for acknowledgement",
      );
      assert.equal(
        server.controls.filter((x) => x.action === "interrupt").length,
        1,
      );
      assert.equal(
        await page.evaluate(() =>
          window.__tracks.every((t) => t.readyState === "ended"),
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "Clear invalidates a replay waiting for audio permission",
    async () => {
      const { page, context } = await setup();
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .click();
      await page
        .getByText("Session complete. Your translations are ready to replay.")
        .waitFor();
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        window.__scheduledAudio = 0;
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          window.__scheduledAudio++;
          return start.apply(this, args);
        };
        AudioContext.prototype.resume = () =>
          new Promise((resolve) => {
            window.__resumeReplay = resolve;
          });
      });
      await page
        .getByRole("button", { name: "Replay translation 1", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Clear conversation", exact: true })
        .click();
      await page.evaluate(() => window.__resumeReplay());
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__scheduledAudio), 0);
      await context.close();
    },
  );
  await check(
    "desktop/mobile layout has no overflow and target selector is keyboard accessible",
    async () => {
      const { page, context, errors } = await setup();
      for (const [width, height] of [
        [1440, 1100],
        [390, 844],
        [320, 740],
      ]) {
        await page.setViewportSize({ width, height });
        if (process.env.SCREENSHOT_DIR)
          await page.screenshot({
            path: `${process.env.SCREENSHOT_DIR}/relay-${width}.png`,
            fullPage: true,
          });
        const overflow = await page.evaluate(() => ({
          width: innerWidth,
          document: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              right: e.getBoundingClientRect().right,
            }))
            .slice(0, 12),
        }));
        assert.ok(overflow.document <= width, JSON.stringify(overflow));
      }
      const select = page.getByLabel("TRANSLATE INTO");
      await select.selectOption("Japanese");
      assert.equal(await select.inputValue(), "Japanese");
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "audio is framed, Stop releases mic and keeps final captions/audio replay",
    async () => {
      const { page, context, stats, errors } = await setup();
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .waitFor();
      await page.waitForFunction(() => window.__tracks.length > 0);
      await page.waitForTimeout(350);
      const captured = stats();
      assert.ok(captured.packets > 0);
      assert.equal(captured.bytes / captured.packets, 1920);
      await page
        .getByRole("button", { name: "Stop speaking", exact: true })
        .click();
      await page
        .getByText("Session complete. Your translations are ready to replay.")
        .waitFor();
      assert.equal(
        await page.evaluate(() =>
          window.__tracks.every((t) => t.readyState === "ended"),
        ),
        true,
      );
      assert.equal(
        await page.getByText("नमस्ते दुनिया", { exact: true }).count(),
        1,
      );
      const replay = page.getByRole("button", {
        name: "Replay translation 1",
        exact: true,
      });
      assert.equal(await replay.isEnabled(), true);
      await replay.click();
      await page
        .getByRole("button", { name: "Clear conversation", exact: true })
        .click();
      assert.equal(
        await page.getByText("नमस्ते दुनिया", { exact: true }).count(),
        0,
      );
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "microphone permission denial shows actionable error and allows retry",
    async () => {
      const { page, context, errors } = await setup({ denied: true });
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page.locator(".notice-error").waitFor();
      assert.match(
        await page.locator(".notice-error").innerText(),
        /Microphone access was denied/,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Try again", exact: true })
          .isEnabled(),
        true,
      );
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "cancel during pending microphone permission stops the late stream",
    async () => {
      const { page, context, errors } = await setup({ delayPermission: 800 });
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page.waitForFunction(() => window.__permissionCalls === 1);
      await page
        .getByRole("button", { name: "Cancel connection", exact: true })
        .click();
      await page.waitForFunction(() => window.__tracks.length > 0);
      assert.equal(
        await page.evaluate(() =>
          window.__tracks.every((t) => t.readyState === "ended"),
        ),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Start speaking", exact: true })
          .isEnabled(),
        true,
      );
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
  await check(
    "cancel during cold start never requests microphone access",
    async () => {
      const { page, context, errors } = await setup({ slowHealth: true });
      await page
        .getByRole("button", { name: "Start speaking", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Cancel connection", exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.__permissionCalls), 0);
      assert.deepEqual(errors, []);
      await context.close();
    },
  );
} finally {
  await browser.close();
}
console.log(`${checks} browser checks passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
