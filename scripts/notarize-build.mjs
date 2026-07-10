// Runs `electron-builder --mac` with the Apple notarization credentials loaded
// from a local `.env` file, so you never have to remember to `source` it.
//
// - Loads `.env` (if present) WITHOUT overriding vars already in the environment
//   (so CI can inject real secrets and this stays a no-op there).
// - Fails early with a clear message if any required credential is missing,
//   instead of letting electron-builder emit a cryptic signing error.
// - Any extra CLI args are forwarded to electron-builder (e.g. `--publish never`).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ENV_FILE = new URL('../.env', import.meta.url)

/** Minimal .env parser: KEY=VALUE lines, `#` comments, optional surrounding quotes. */
function loadDotEnv() {
  if (!existsSync(ENV_FILE)) return
  for (const raw of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Do not override credentials already present in the environment (e.g. CI).
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

const REQUIRED = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error(
    `\n✖ Missing notarization credential(s): ${missing.join(', ')}\n` +
      '  Create a .env from .env.example and fill it in (see README / .env.example).\n'
  )
  process.exit(1)
}

const builder = new URL('../node_modules/.bin/electron-builder', import.meta.url)
const extraArgs = process.argv.slice(2)

try {
  execFileSync(fileURLToPath(builder), ['--mac', ...extraArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env
  })
} catch {
  // electron-builder already printed its error to the inherited stdio.
  process.exit(1)
}
