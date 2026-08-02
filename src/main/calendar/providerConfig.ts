// OAuth client IDs for the calendar providers.
//
// These are PUBLIC client IDs for desktop (public) clients: with PKCE there is no
// client secret and the ID is safe to embed in the build (extractable by design —
// security relies on PKCE + registered redirect URIs + per-user tokens, not on
// keeping the ID secret). Provided at build time via electron-vite env vars
// (MAIN_VITE_* in `.env`). When a provider's ID is absent, that provider is
// feature-gated off in the UI (isConfigured === false) — no crash.

export const GOOGLE_CLIENT_ID = import.meta.env.MAIN_VITE_GOOGLE_OAUTH_CLIENT_ID ?? ''
/**
 * Google "Desktop app" clients require the client secret at the token endpoint
 * even with PKCE. Google documents it as NOT a real secret for installed apps
 * (it ships inside the binary). Microsoft public clients use no secret.
 */
export const GOOGLE_CLIENT_SECRET = import.meta.env.MAIN_VITE_GOOGLE_OAUTH_CLIENT_SECRET ?? ''
export const MICROSOFT_CLIENT_ID = import.meta.env.MAIN_VITE_MICROSOFT_OAUTH_CLIENT_ID ?? ''
/** 'common' = work + personal Microsoft accounts. */
export const MICROSOFT_TENANT = import.meta.env.MAIN_VITE_MICROSOFT_TENANT ?? 'common'
