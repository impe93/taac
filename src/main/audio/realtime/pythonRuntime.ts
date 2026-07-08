/**
 * Python Runtime Resolver
 *
 * Locates the Python interpreter and bridge script used by the realtime
 * ASR sidecar (Qwen3-ASR via MLX). Resolution order for the interpreter:
 *   1. TAAC_ASR_PYTHON env var (explicit override, useful for debugging)
 *   2. Packaged app: bundled python-build-standalone runtime under
 *      {Resources}/python-runtime/ (see scripts/prepare-asr-runtime.sh)
 *   3. Dev mode: project-local .venv-asr (see "setup:asr-dev" script)
 *
 * §3.7: All log lines are prefixed with [PythonRuntime].
 */

import { app } from 'electron'
import { join, sep } from 'node:path'
import fs from 'node:fs/promises'

async function isExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the Python interpreter for the ASR sidecar.
 * Returns null when no runtime is available (feeds checkRealtimeAvailability).
 */
export async function resolveAsrPython(): Promise<string | null> {
  const candidates: string[] = []

  if (process.env.TAAC_ASR_PYTHON) {
    candidates.push(process.env.TAAC_ASR_PYTHON)
  }

  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'python-runtime', 'bin', 'python3'))
  } else {
    candidates.push(join(app.getAppPath(), '.venv-asr', 'bin', 'python'))
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return candidate
    }
  }

  console.log(
    '[PythonRuntime] No ASR Python runtime found (checked: ' + candidates.join(', ') + ')'
  )
  return null
}

/**
 * Resolve the JSONL bridge script path. The script lives in resources/asr/,
 * which electron-builder unpacks from the asar (asarUnpack: resources/**) —
 * same redirect pattern as the ffmpeg-static binary in audioConverter.ts.
 */
export function resolveAsrBridgePath(): string {
  const raw = join(app.getAppPath(), 'resources', 'asr', 'qwen3_asr_bridge.py')
  return raw.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

/**
 * Resolve the Python interpreter for the LLM text-generation sidecar.
 *
 * Shares the same bundled runtime as the ASR sidecar (both bridges run on the
 * one packaged `python-runtime/` / dev `.venv-asr`). `TAAC_LLM_PYTHON` overrides
 * for debugging; otherwise it falls back to the ASR override and the standard
 * locations. Returns null when no runtime is available.
 */
export async function resolveLlmPython(): Promise<string | null> {
  const candidates: string[] = []

  if (process.env.TAAC_LLM_PYTHON) candidates.push(process.env.TAAC_LLM_PYTHON)
  if (process.env.TAAC_ASR_PYTHON) candidates.push(process.env.TAAC_ASR_PYTHON)

  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'python-runtime', 'bin', 'python3'))
  } else {
    candidates.push(join(app.getAppPath(), '.venv-asr', 'bin', 'python'))
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate
  }

  console.log(
    '[PythonRuntime] No LLM Python runtime found (checked: ' + candidates.join(', ') + ')'
  )
  return null
}

/** Resolve the mlx-lm JSONL bridge script path (resources/llm/). */
export function resolveLlmBridgePath(): string {
  const raw = join(app.getAppPath(), 'resources', 'llm', 'mlx_llm_bridge.py')
  return raw.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}
