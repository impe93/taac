/**
 * Realtime Transcription Availability
 *
 * Central gate for the realtime ASR path (Qwen3-ASR MLX sidecar).
 * Every requirement failure returns a distinct machine-readable reason so
 * the recorder UI and logs can explain why the live path is inactive.
 * When unavailable, recording still works — transcription falls back to
 * the whisper post-processing pipeline.
 *
 * Requirements: macOS 15+ on Apple Silicon, feature not disabled in config,
 * ASR + VAD models downloaded, Python sidecar runtime resolvable.
 *
 * §3.7: All log lines are prefixed with [RealtimeAvailability].
 */

import { app } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import { configStore } from '../../utils/configStore'
import { ModelRegistry } from '../../ai/ModelRegistry'
import { resolveAsrPython } from './pythonRuntime'

export interface RealtimeAvailability {
  available: boolean
  /** Machine-readable reason when unavailable */
  reason?:
    | 'unsupported-platform'
    | 'unsupported-os-version'
    | 'disabled-in-settings'
    | 'asr-model-missing'
    | 'vad-model-missing'
    | 'python-runtime-missing'
}

const MIN_MACOS_MAJOR = 15

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path)
    return stats.size > 0
  } catch {
    return false
  }
}

/** Resolve the on-disk directory of the configured MLX ASR model. */
export function getAsrModelDir(): string {
  const { asrModelId } = configStore.get('meeting')
  return join(app.getPath('userData'), 'models', asrModelId)
}

/** Resolve the on-disk path of the Silero VAD model. */
export function getVadModelPath(): string {
  const vadModel = ModelRegistry.getVadModels()[0]
  return join(app.getPath('userData'), 'models', vadModel?.filename ?? 'silero_vad.onnx')
}

/**
 * Check whether the realtime transcription path can run on this machine.
 */
export async function checkRealtimeAvailability(): Promise<RealtimeAvailability> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return { available: false, reason: 'unsupported-platform' }
  }

  const osMajor = parseInt(process.getSystemVersion(), 10)
  if (Number.isNaN(osMajor) || osMajor < MIN_MACOS_MAJOR) {
    return { available: false, reason: 'unsupported-os-version' }
  }

  const meeting = configStore.get('meeting')
  if (meeting.realtimeTranscription === 'off') {
    return { available: false, reason: 'disabled-in-settings' }
  }

  // ASR model: multi-file MLX checkpoint — every declared file must exist
  const asrModel = ModelRegistry.getModel(meeting.asrModelId)
  if (!asrModel || !asrModel.files || asrModel.files.length === 0) {
    return { available: false, reason: 'asr-model-missing' }
  }
  const asrModelDir = getAsrModelDir()
  for (const file of asrModel.files) {
    if (!(await fileExists(join(asrModelDir, file.filename)))) {
      return { available: false, reason: 'asr-model-missing' }
    }
  }

  if (!(await fileExists(getVadModelPath()))) {
    return { available: false, reason: 'vad-model-missing' }
  }

  if ((await resolveAsrPython()) === null) {
    return { available: false, reason: 'python-runtime-missing' }
  }

  return { available: true }
}
