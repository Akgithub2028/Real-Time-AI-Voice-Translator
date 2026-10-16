import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

function createProcessor() {
  const messages = [];
  let Processor;
  vm.runInNewContext(
    readFileSync(
      new URL("../public/pcm-processor.js", import.meta.url),
      "utf8",
    ),
    {
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage: (x) => messages.push(x) };
        }
      },
      registerProcessor: (_, value) => {
        Processor = value;
      },
      sampleRate: 48000,
    },
  );
  return { processor: new Processor(), messages };
}

test("buffers audio into 20ms frames instead of transmitting each render quantum", () => {
  const { processor, messages } = createProcessor();
  for (let i = 0; i < 15; i++)
    processor.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].byteLength, 1920);
  assert.equal(new Int16Array(messages[0])[0], 16383);
});

test("flushes partial audio before acknowledging Stop and stops accepting input", () => {
  const { processor, messages } = createProcessor();
  processor.process([[new Float32Array(128).fill(-1)]]);
  processor.port.onmessage({ data: "flush" });
  assert.equal(messages[0].byteLength, 256);
  assert.equal(new Int16Array(messages[0])[0], -32768);
  assert.equal(messages[1].type, "flushed");
  processor.process([[new Float32Array(128)]]);
  assert.equal(messages.length, 2);
});
