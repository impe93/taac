import { safeStorage } from 'electron'
import type { OAuthTokens } from './types'

/**
 * OAuth token storage backed by Electron safeStorage (macOS Keychain / Windows
 * DPAPI / libsecret). Tokens are only ever encrypted/decrypted in the main
 * process and never travel over IPC to the renderer.
 */

export function isSecureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function encryptTokens(tokens: OAuthTokens): string {
  if (!isSecureStorageAvailable()) {
    throw new Error('Secure storage is not available on this system.')
  }
  return safeStorage.encryptString(JSON.stringify(tokens)).toString('base64')
}

export function decryptTokens(blob: string): OAuthTokens {
  const buffer = Buffer.from(blob, 'base64')
  return JSON.parse(safeStorage.decryptString(buffer)) as OAuthTokens
}
