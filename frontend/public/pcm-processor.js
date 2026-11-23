/**
 * Web Audio AudioWorkletProcessor that downsamples capture audio to 16kHz Int16 PCM,
 * estimates live RMS vs adaptive noise floor for SNR dB telemetry, and tracks dropped frames.
 */
class DockPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._chunkSamples = 1600; // 100ms at 16kHz
    this._noiseFloorRms = 0.008;
    this._droppedFrames = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }
    const samples = input[0];

    let sumSq = 0;
    let clipped = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      sumSq += s * s;
      if (Math.abs(s) >= 0.995) {
        clipped += 1;
      }
    }
    if (clipped > samples.length * 0.25) {
      this._droppedFrames += 1;
    }

    const rms = Math.sqrt(sumSq / samples.length);
    if (rms < this._noiseFloorRms * 1.4 || this._noiseFloorRms <= 0.0005) {
      this._noiseFloorRms = this._noiseFloorRms * 0.94 + Math.max(rms, 0.0004) * 0.06;
    }

    const ratio = this._sampleRatio();
    for (let outPos = 0; outPos < samples.length; outPos += ratio) {
      const idx = Math.min(samples.length - 1, Math.floor(outPos));
      const clamped = Math.max(-1, Math.min(1, samples[idx]));
      this._buffer.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    }

    if (this._buffer.length >= this._chunkSamples) {
      const chunk = new Int16Array(this._buffer.splice(0, this._chunkSamples));
      const snrDb = 20 * Math.log10(Math.max(rms, 0.0001) / Math.max(this._noiseFloorRms, 0.0001));
      this.port.postMessage(
        {
          pcm16: chunk.buffer,
          rms: Number(rms.toFixed(5)),
          snrDb: Number(Math.max(-6, Math.min(36, snrDb)).toFixed(1)),
          droppedFrames: this._droppedFrames,
        },
        [chunk.buffer]
      );
    }
    return true;
  }

  _sampleRatio() {
    const sr = typeof sampleRate === "number" && sampleRate > 16000 ? sampleRate : 48000;
    return sr / 16000;
  }
}

registerProcessor("dock-pcm-processor", DockPcmProcessor);
