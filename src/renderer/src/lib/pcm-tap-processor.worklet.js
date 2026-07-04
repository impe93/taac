/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain-JS
   worklet source, imported as raw text and executed inside the AudioWorklet
   global scope (no TypeScript). */
/**
 * pcm-tap AudioWorkletProcessor
 *
 * Runs at the AudioContext's NATIVE sample rate (creating a 16 kHz context and
 * letting Chromium resample MediaStream sources is unreliable across devices —
 * real microphones and ScreenCaptureKit display-audio tracks can throw where
 * the fake test device works). Mixes input channels down to mono, resamples to
 * 16 kHz via linear interpolation, converts to s16 and posts fixed-size chunks
 * of 4096 samples (256 ms) to the main thread via the port.
 *
 * Gate: `port.postMessage({ gate: false })` drops samples WITHOUT counting
 * them, so the downstream sample clock stays aligned with the
 * pause-compressed WAV timeline used by diarization.
 *
 * Loaded via Blob URL from raw source (see pcmTapStreamer.ts) — file:// module
 * loading is unreliable for worklets in packaged Electron apps.
 */

const TARGET_RATE = 16000
const CHUNK_SAMPLES = 4096

class PcmTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(CHUNK_SAMPLES)
    this.offset = 0
    this.gate = true
    // Resampler state: `sampleRate` is the AudioWorklet global (context rate)
    this.ratio = sampleRate / TARGET_RATE
    this.carry = new Float32Array(0)
    this.readPos = 0
    this.port.onmessage = (event) => {
      if (typeof event.data?.gate === 'boolean') {
        this.gate = event.data.gate
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0 || !this.gate) return true

    const channelCount = input.length
    const frameCount = input[0].length

    // Mix down to mono and append to the carry-over buffer
    const pending = new Float32Array(this.carry.length + frameCount)
    pending.set(this.carry, 0)
    for (let frame = 0; frame < frameCount; frame++) {
      let sample = 0
      for (let channel = 0; channel < channelCount; channel++) {
        sample += input[channel][frame]
      }
      pending[this.carry.length + frame] = sample / channelCount
    }

    // Consume at TARGET_RATE via linear interpolation
    while (this.readPos + 1 < pending.length) {
      const index = Math.floor(this.readPos)
      const frac = this.readPos - index
      const sample = pending[index] * (1 - frac) + pending[index + 1] * frac

      const clamped = Math.max(-1, Math.min(1, sample))
      this.buffer[this.offset++] = Math.round(clamped * 32767)

      if (this.offset === CHUNK_SAMPLES) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer])
        this.buffer = new Int16Array(CHUNK_SAMPLES)
        this.offset = 0
      }

      this.readPos += this.ratio
    }

    // Keep the unconsumed tail (at most ~ratio+1 samples)
    const consumed = Math.floor(this.readPos)
    this.carry = pending.slice(consumed)
    this.readPos -= consumed

    return true
  }
}

registerProcessor('pcm-tap', PcmTapProcessor)
