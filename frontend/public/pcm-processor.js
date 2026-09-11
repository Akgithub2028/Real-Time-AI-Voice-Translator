// AudioWorklet runs on a separate audio-rendering thread, not the main
// thread - keeps mic capture from janking if the UI thread gets busy.
// Job here: convert Web Audio's float32 samples (-1.0 to 1.0) to int16
// PCM (-32768 to 32767), which is what the backend's config.py expects.

class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length === 0) return true;

    const channelData = input[0]; // mono - single channel only
    const int16Buffer = new Int16Array(channelData.length);

    for (let i = 0; i < channelData.length; i++) {
      // Clamp to [-1, 1] before scaling - guards against occasional
      // out-of-range float samples that would otherwise wrap around
      // as int16 overflow noise.
      const clamped = Math.max(-1, Math.min(1, channelData[i]));
      int16Buffer[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }

    // Transfer the underlying buffer (zero-copy) to the main thread.
    this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);
    return true; // keep processor alive for next audio block
  }
}

registerProcessor("pcm-processor", PcmProcessor);
