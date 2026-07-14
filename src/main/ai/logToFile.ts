import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Append a timestamped line to a log file under Electron's `logs` directory
 * (`~/Library/Logs/{productName}/` on macOS). Best-effort: never throws.
 *
 * Packaged apps have no attached terminal, so `console.*` output from the main
 * process and its Python sidecars is otherwise unreachable. This gives us a
 * durable place to record sidecar crashes (e.g. a jetsam SIGKILL under memory
 * pressure) that users can retrieve without launching the app from a shell.
 */
export function writeToLog(message: string, file = 'ai.log'): void {
  try {
    const logFile = join(app.getPath('logs'), file)
    const timestamp = new Date().toISOString()
    appendFileSync(logFile, `[${timestamp}] ${message}\n`)
  } catch {
    // ignore logging errors
  }
}
