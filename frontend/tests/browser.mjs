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
  await page.routeWebSocket("**/ws/translate", (ws) => {
    ws.onMessage((data) => {
      if (typeof data !== "string") {
        packets++;
        bytes += data.length;
        return;
      }
      const msg = JSON.parse(data);
      if (msg.target_language)
        ws.send(JSON.stringify({ type: "ready", character_limit: 600 }));
      if (msg.action === "stop") {
        ws.send(
          JSON.stringify({
            type: "transcript",
            source_text: "Hello world",
            translated_text: "नमस्ते दुनिया",
          }),
        );
        ws.send(Buffer.alloc(9600, 1));
        ws.send(JSON.stringify({ type: "usage", characters: 12 }));
        ws.send(JSON.stringify({ type: "stopped" }));
      }
    });
  });
  await page.goto(base);
  return { page, context, errors, stats: () => ({ packets, bytes }) };
}

try {
  await check("Clear invalidates a replay waiting for audio permission", async () => {
    const { page, context } = await setup();
    await page.getByRole("button", { name: "Start speaking", exact: true }).click();
    await page.getByRole("button", { name: "Stop speaking", exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
    await page.getByText("Session complete. Your translations are ready to replay.").waitFor();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__scheduledAudio = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) { window.__scheduledAudio++; return start.apply(this, args); };
      AudioContext.prototype.resume = () => new Promise(resolve => { window.__resumeReplay = resolve; });
    });
    await page.getByRole("button", { name: "Replay translation 1", exact: true }).click();
    await page.getByRole("button", { name: "Clear conversation", exact: true }).click();
    await page.evaluate(() => window.__resumeReplay());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__scheduledAudio), 0);
    await context.close();
  });
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
