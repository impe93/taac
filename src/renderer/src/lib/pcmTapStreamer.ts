/**
 * PcmTapStreamer — live PCM tap on a MediaStream for realtime transcription
 *
 * Runs alongside the archival MediaRecorder without touching it: an
 * AudioContext at the NATIVE device rate feeds the pcm-tap AudioWorklet,
 * which downsamples to 16 kHz mono s16 and posts chunks that are forwarded
 * to the main process over IPC (~32 KB/s per track).
 *
 * The context deliberately does NOT force a 16 kHz sample rate: attaching
 * MediaStream sources (real microphones, ScreenCaptureKit display audio) to
 * a context at a non-native rate is unreliable in Chromium — resampling
 * happens inside the worklet instead.
 *
 * The worklet is loaded from a Blob URL built from raw source — file://
 * module loading is unreliable for worklets in packaged Electron apps.
 */

import workletSource from './pcm-tap-processor.worklet.js?raw'

export interface PcmTapStreamerOptions {
  stream: MediaStream
  track: 'mic' | 'system'
  noteId: string
}

export class PcmTapStreamer {
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private readonly options: PcmTapStreamerOptions

  constructor(options: PcmTapStreamerOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    if (this.context) return

    const context = new AudioContext()
    this.context = context

    const workletUrl = URL.createObjectURL(
      new Blob([workletSource], { type: 'application/javascript' })
    )
    try {
      await context.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    const source = context.createMediaStreamSource(this.options.stream)
    const node = new AudioWorkletNode(context, 'pcm-tap')
    this.node = node

    node.port.onmessage = (event: MessageEvent<ArrayBuffer>): void => {
      window.audio.pushRealtimePcm(this.options.noteId, this.options.track, event.data)
    }

    // A muted sink keeps the graph pulled without audible output
    const sink = context.createGain()
    sink.gain.value = 0
    source.connect(node)
    node.connect(sink)
    sink.connect(context.destination)
  }

  /** Gate the tap during pause — gated samples are dropped, not counted */
  setGate(open: boolean): void {
    this.node?.port.postMessage({ gate: open })
  }

  async stop(): Promise<void> {
    if (this.node) {
      this.node.port.onmessage = null
      try {
        this.node.disconnect()
      } catch {
        // Already disconnected
      }
      this.node = null
    }
    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => {})
    }
    this.context = null
  }
}
