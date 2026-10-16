// Mono signed little-endian PCM, emitted in 20 ms packets.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(Math.round(sampleRate * 0.02));
    this.offset = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        this.active = false;
        if (this.offset) {
          const tail = this.frame.slice(0, this.offset);
          this.port.postMessage(tail.buffer, [tail.buffer]);
          this.offset = 0;
        }
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  process(inputs) {
    if (!this.active) return true;
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const value = Math.max(-1, Math.min(1, channel[i]));
      this.frame[this.offset++] = value < 0 ? value * 32768 : value * 32767;
      if (this.offset === this.frame.length) {
        const ready = this.frame;
        this.port.postMessage(ready.buffer, [ready.buffer]);
        this.frame = new Int16Array(Math.round(sampleRate * 0.02));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-processor", PcmProcessor);
