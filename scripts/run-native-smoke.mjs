import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const smokeScript = fileURLToPath(new URL('./verify-native-runtime.mjs', import.meta.url))

// ELECTRON_RUN_AS_NODE loads native addons with Electron's Node ABI without
// opening a GUI. This makes the same check reliable on developer machines and
// headless Windows CI runners.
const result = spawnSync(electronPath, [smokeScript], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

if (result.error) {
  console.error('[native-smoke] Failed to start Electron runtime:', result.error)
  process.exit(1)
}

if (result.signal) {
  console.error(`[native-smoke] Electron runtime exited with signal ${result.signal}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
