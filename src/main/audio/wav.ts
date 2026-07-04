/**
 * Minimal WAV (RIFF) reader for the meeting pipeline.
 *
 * Reads only the leading portion of a WAV file's PCM payload without loading
 * the whole file — used by WhisperService's windowed language detection, which
 * needs raw s16 samples to feed the binding's transcribeData(). Kept separate
 * from audioConverter.ts so the processing worker bundle does not pull in the
 * fluent-ffmpeg import side effects.
 *
 * §3.7  all log lines are prefixed with [WavReader]
 */

import { open } from 'node:fs/promises'

/** Expected format produced by audioConverter.convertToWav(). */
const EXPECTED_SAMPLE_RATE = 16_000
const EXPECTED_CHANNELS = 1
const EXPECTED_BITS_PER_SAMPLE = 16
const WAVE_FORMAT_PCM = 1

export interface WavPcmPrefix {
  /** Leading raw signed 16-bit little-endian mono PCM (always even length). */
  pcm: Buffer
  /** Total byte length of the file's data chunk (may exceed pcm.length). */
  dataLength: number
  sampleRate: number
}

/**
 * Read up to `maxBytes` of PCM from a 16 kHz mono s16le WAV file.
 *
 * Walks the RIFF chunk list (ffmpeg may emit LIST/other chunks before data,
 * so the 44-byte canonical header must not be assumed) honouring the RIFF
 * word-alignment padding. Returns null — never throws — when the file is not
 * a WAV or does not match the pipeline's 16 kHz mono s16 PCM contract, so
 * callers can fall back gracefully.
 */
export async function readWavPcmPrefix(
  filePath: string,
  maxBytes: number
): Promise<WavPcmPrefix | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(filePath, 'r')
    const fileSize = (await handle.stat()).size

    const riffHeader = Buffer.alloc(12)
    if ((await handle.read(riffHeader, 0, 12, 0)).bytesRead < 12) {
      console.warn(`[WavReader] File too small to be a WAV: "${filePath}"`)
      return null
    }
    if (
      riffHeader.toString('ascii', 0, 4) !== 'RIFF' ||
      riffHeader.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      console.warn(`[WavReader] Not a RIFF/WAVE file: "${filePath}"`)
      return null
    }

    let offset = 12
    let sampleRate = 0
    let channels = 0
    let bitsPerSample = 0
    let audioFormat = 0
    let sawFmt = false

    const chunkHeader = Buffer.alloc(8)
    while (offset + 8 <= fileSize) {
      if ((await handle.read(chunkHeader, 0, 8, offset)).bytesRead < 8) break
      const chunkId = chunkHeader.toString('ascii', 0, 4)
      const chunkSize = chunkHeader.readUInt32LE(4)
      const chunkStart = offset + 8

      if (chunkId === 'fmt ') {
        const fmt = Buffer.alloc(Math.min(chunkSize, 16))
        if ((await handle.read(fmt, 0, fmt.length, chunkStart)).bytesRead < 16) {
          console.warn(`[WavReader] Truncated fmt chunk: "${filePath}"`)
          return null
        }
        audioFormat = fmt.readUInt16LE(0)
        channels = fmt.readUInt16LE(2)
        sampleRate = fmt.readUInt32LE(4)
        bitsPerSample = fmt.readUInt16LE(14)
        sawFmt = true
      } else if (chunkId === 'data') {
        if (!sawFmt) {
          console.warn(`[WavReader] data chunk before fmt chunk: "${filePath}"`)
          return null
        }
        if (
          audioFormat !== WAVE_FORMAT_PCM ||
          channels !== EXPECTED_CHANNELS ||
          sampleRate !== EXPECTED_SAMPLE_RATE ||
          bitsPerSample !== EXPECTED_BITS_PER_SAMPLE
        ) {
          console.warn(
            `[WavReader] Unexpected format (fmt=${audioFormat}, ch=${channels}, ` +
              `rate=${sampleRate}, bits=${bitsPerSample}) — expected 16 kHz mono s16 PCM: "${filePath}"`
          )
          return null
        }
        // Clamp to the real file size (streamed WAVs can declare bogus sizes),
        // then to the caller's budget; force an even length for s16 samples.
        const dataLength = Math.min(chunkSize, fileSize - chunkStart)
        const readLength = Math.min(dataLength, maxBytes) & ~1
        if (readLength <= 0) {
          console.warn(`[WavReader] Empty data chunk: "${filePath}"`)
          return null
        }
        const pcm = Buffer.alloc(readLength)
        const { bytesRead } = await handle.read(pcm, 0, readLength, chunkStart)
        return {
          pcm: bytesRead === readLength ? pcm : pcm.subarray(0, bytesRead & ~1),
          dataLength,
          sampleRate
        }
      }

      // Guard against malformed sizes that would loop forever.
      if (chunkSize === 0 && chunkId !== 'data') {
        console.warn(`[WavReader] Zero-sized "${chunkId}" chunk — aborting scan: "${filePath}"`)
        return null
      }
      offset = chunkStart + chunkSize + (chunkSize % 2) // RIFF word alignment
    }

    console.warn(`[WavReader] No data chunk found: "${filePath}"`)
    return null
  } catch (err) {
    console.warn(`[WavReader] Failed to read "${filePath}":`, err)
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}
