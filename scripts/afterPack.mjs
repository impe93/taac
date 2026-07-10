// electron-builder afterPack hook.
//
// Deep-signs the embedded Python runtime (CPython + MLX dylibs + the ffmpeg
// binary shipped inside python-runtime) BEFORE electron-builder signs the app
// bundle. These Mach-O files land under Contents/Resources/python-runtime via
// `mac.extraResources` and are NOT reliably signed by electron-builder's own
// signing pass — leaving them unsigned makes Apple notarization reject the app.
//
// Each Mach-O is signed with the Hardened Runtime + our entitlements
// (disable-library-validation is what lets the interpreter dlopen the other
// unsigned-by-Apple bundled dylibs at runtime). Signing loose files in any
// order is fine — codesign signs the file itself, not its link dependencies.
//
// The hook is a no-op on non-macOS packing and skips gracefully (with a loud
// warning) when no Developer ID identity is available, so dev/unpack builds
// still work.

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTITLEMENTS = fileURLToPath(new URL('../build/entitlements.mac.plist', import.meta.url))

/**
 * Resolve the code-signing identity as the SHA-1 hash of the Developer ID
 * Application certificate. The hash (not the name) is used on purpose: an
 * "Apple Development" cert can share the same common name as the Developer ID
 * one, so signing by name would be ambiguous and could pick the wrong cert.
 * `TAAC_SIGN_IDENTITY` overrides (accepts a hash or a full identity string).
 */
function resolveIdentity() {
  if (process.env.TAAC_SIGN_IDENTITY) return process.env.TAAC_SIGN_IDENTITY

  let out = ''
  try {
    out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8'
    })
  } catch {
    return null
  }
  const line = out.split('\n').find((l) => l.includes('Developer ID Application:'))
  if (!line) return null
  const hash = line.match(/\b([0-9A-Fa-f]{40})\b/)
  return hash ? hash[1] : null
}

/** True if the path is a real (non-symlink) Mach-O binary. */
function isMachO(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) return false
  } catch {
    return false
  }
  try {
    const out = execFileSync('file', ['--brief', path], { encoding: 'utf8' })
    return /Mach-O/.test(out)
  } catch {
    return false
  }
}

/** Recursively collect real Mach-O files under `dir`. */
function collectMachO(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      collectMachO(full, acc)
    } else if (entry.isFile() && isMachO(full)) {
      acc.push(full)
    }
  }
  return acc
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const runtimeDir = join(context.appOutDir, 'python-runtime')
  if (!existsSync(runtimeDir)) {
    console.log(`[afterPack] python-runtime not found at ${runtimeDir}; nothing to sign.`)
    return
  }

  const identity = resolveIdentity()
  if (!identity) {
    console.warn(
      '[afterPack] No Developer ID Application identity found (set CSC_NAME or install a cert). ' +
        'Skipping python-runtime signing — notarization WILL fail for this build.'
    )
    return
  }

  const binaries = collectMachO(runtimeDir)
  // Sign deepest-first for tidiness (order is not strictly required for loose files).
  binaries.sort((a, b) => b.split('/').length - a.split('/').length)

  console.log(
    `[afterPack] Deep-signing ${binaries.length} Mach-O file(s) in python-runtime with "${identity}".`
  )

  let signed = 0
  for (const file of binaries) {
    try {
      execFileSync(
        'codesign',
        [
          '--force',
          '--options',
          'runtime',
          '--timestamp',
          '--entitlements',
          ENTITLEMENTS,
          '--sign',
          identity,
          file
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      )
      signed++
    } catch (err) {
      const stderr = err?.stderr ? err.stderr.toString() : String(err)
      throw new Error(`[afterPack] Failed to codesign ${file}:\n${stderr}`)
    }
  }

  console.log(`[afterPack] Signed ${signed}/${binaries.length} Mach-O file(s) in python-runtime.`)
}
