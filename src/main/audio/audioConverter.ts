/**
 * AudioConverter
 *
 * Converts WebM/Opus recordings to 16 kHz mono PCM WAV files required
 * by Whisper (sherpa-onnx). Uses fluent-ffmpeg with the bundled
 * ffmpeg-static binary so no system-wide ffmpeg installation is needed.
 *
 * §3.7: All log lines are prefixed with [AudioConverter].
 */

import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { sep } from 'node:path'

// Set the ffmpeg binary path once at module load time.
// ffmpeg-static exports the path string (null only if the binary is missing).
const rawFfmpegPath: string | null = ffmpegStatic
if (rawFfmpegPath) {
  // In a packaged Electron app, ffmpeg-static resolves its __dirname to the
  // virtual asar path (e.g. .../app.asar/node_modules/ffmpeg-static/ffmpeg).
  // app.asar is a file, not a directory — spawn() gets ENOTDIR when it tries
  // to execute a binary from inside it. The binary is physically extracted to
  // app.asar.unpacked by electron-builder (asarUnpack config), so we redirect
  // the path there. In dev mode the path never contains "app.asar", so this
  // replace is a safe no-op.
  const ffmpegPath = rawFfmpegPath.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
  ffmpeg.setFfmpegPath(ffmpegPath)
} else {
  console.warn('[AudioConverter] ffmpeg-static binary not found — conversion will likely fail')
}

/**
 * Convert an audio file to 16 kHz mono 16-bit PCM WAV.
 *
 * The output format is what Whisper (and most ASR models) expect:
 *   - Sample rate : 16 000 Hz
 *   - Channels    : 1 (mono)
 *   - Codec       : pcm_s16le (signed 16-bit little-endian)
 *   - Container   : WAV
 *
 * @param inputPath  Absolute path to the source file (e.g. mic.webm)
 * @param outputPath Absolute path for the destination WAV file
 *
 * §3.6 (Path Validation): both paths must be non-empty strings. The
 * caller is responsible for ensuring they are within the expected
 * userData directory tree to prevent directory-traversal attacks.
 */
export async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  if (!inputPath || !outputPath) {
    throw new Error('[AudioConverter] convertToWav: inputPath and outputPath must be non-empty')
  }

  console.log(`[AudioConverter] Converting "${inputPath}" → "${outputPath}"`)

  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`[AudioConverter] ffmpeg command: ${cmd}`)
      })
      .on('end', () => {
        console.log(`[AudioConverter] Conversion complete → "${outputPath}"`)
        resolve()
      })
      .on('error', (err) => {
        console.error(`[AudioConverter] Conversion failed: ${err.message}`)
        reject(new Error(`[AudioConverter] ffmpeg error: ${err.message}`))
      })
      .run()
  })
}
