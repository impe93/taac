// electron-builder afterAllArtifactBuild hook.
//
// electron-builder notarizes and staples the .app (which is then embedded in the
// .dmg/.zip), but it does NOT submit the .dmg container itself to Apple — so the
// downloaded .dmg has no stapled ticket and can't be Gatekeeper-verified offline.
// This hook submits each produced .dmg to the notary service and staples the
// resulting ticket, making the disk image self-contained.
//
// Credentials come from the environment (loaded by scripts/notarize-build.mjs):
// APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID. No-op off macOS or when
// credentials are missing (the .app inside is still notarized, so the app-launch
// path already works without a warning).

import { execFileSync } from 'node:child_process'

/**
 * SHA-1 hash of the Developer ID Application cert (unambiguous vs. same-named
 * Apple Development certs). `TAAC_SIGN_IDENTITY` overrides.
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
  const hash = line && line.match(/\b([0-9A-Fa-f]{40})\b/)
  return hash ? hash[1] : null
}

export default async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return []

  const dmgs = (buildResult.artifactPaths ?? []).filter((p) => p.endsWith('.dmg'))
  if (dmgs.length === 0) return []

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.warn(
      '[afterAllArtifactBuild] Missing Apple credentials — skipping DMG notarization. ' +
        'The .app inside is still notarized; only offline DMG verification is affected.'
    )
    return []
  }

  const identity = resolveIdentity()

  for (const dmg of dmgs) {
    // Code-sign the DMG container first so Gatekeeper reports a usable signature
    // (the ticket alone lets it mount, but a signed + notarized DMG is cleanest).
    if (identity) {
      console.log(`[afterAllArtifactBuild] Signing DMG: ${dmg}`)
      execFileSync('codesign', ['--force', '--timestamp', '--sign', identity, dmg], {
        stdio: 'inherit'
      })
    } else {
      console.warn('[afterAllArtifactBuild] No Developer ID identity found — DMG left unsigned.')
    }

    console.log(`[afterAllArtifactBuild] Notarizing DMG: ${dmg}`)
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'submit',
        dmg,
        '--apple-id',
        APPLE_ID,
        '--password',
        APPLE_APP_SPECIFIC_PASSWORD,
        '--team-id',
        APPLE_TEAM_ID,
        '--wait'
      ],
      { stdio: 'inherit' }
    )
    console.log(`[afterAllArtifactBuild] Stapling ticket to: ${dmg}`)
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' })
  }

  // We modified the existing artifacts in place; no new artifacts to register.
  return []
}
