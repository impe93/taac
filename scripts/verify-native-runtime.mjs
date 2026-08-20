/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function pass(name) {
  console.log(`[native-smoke] ✓ ${name}`)
}

async function verify() {
  const Database = require('better-sqlite3')
  const sqliteVec = require('sqlite-vec')
  const db = new Database(':memory:')
  try {
    const extensionPath = sqliteVec.getLoadablePath()
    assert.ok(existsSync(extensionPath), `sqlite-vec extension missing: ${extensionPath}`)
    db.loadExtension(extensionPath)
    const row = db.prepare('SELECT vec_version() AS version').get()
    assert.equal(typeof row?.version, 'string')
  } finally {
    db.close()
  }
  pass('better-sqlite3 + sqlite-vec')

  const ffmpegPath = require('ffmpeg-static')
  assert.equal(typeof ffmpegPath, 'string')
  assert.ok(existsSync(ffmpegPath), `ffmpeg binary missing: ${ffmpegPath}`)
  if (process.platform === 'win32') {
    assert.equal(extname(ffmpegPath).toLowerCase(), '.exe')
  }
  pass('ffmpeg-static')

  const sherpaImport = await import('sherpa-onnx-node')
  const sherpa = sherpaImport.default ?? sherpaImport
  assert.equal(typeof sherpa.OfflineSpeakerDiarization, 'function')
  pass('sherpa-onnx-node')

  const whisperImport = await import('@fugood/whisper.node')
  const whisper = whisperImport.default ?? whisperImport
  const whisperNative = await whisper.loadWhisperModule('default')
  assert.equal(typeof whisperNative.WhisperContext, 'function')
  pass('@fugood/whisper.node (default backend)')

  const { getLlama } = await import('node-llama-cpp')
  const llamaBackend = process.platform === 'darwin' ? 'metal' : false
  await getLlama({ gpu: llamaBackend, dryRun: true })
  pass(`node-llama-cpp (${llamaBackend || 'CPU'} prebuilt)`)

  console.log(`[native-smoke] Runtime verified on ${process.platform}/${process.arch}`)
}

try {
  await verify()
} catch (error) {
  console.error('[native-smoke] FAILED', error)
  process.exitCode = 1
}
