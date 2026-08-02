// Build-time environment variables injected by electron-vite for the main
// process. Prefixed with MAIN_VITE_ so electron-vite exposes them on
// `import.meta.env`. See `.env.example`. These are OAuth *client IDs* — public
// identifiers for desktop/native (public) clients, safe to embed in the build.
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_OAUTH_CLIENT_ID?: string
  /** Google "Desktop app" client secret — required at the token endpoint (not a real secret). */
  readonly MAIN_VITE_GOOGLE_OAUTH_CLIENT_SECRET?: string
  readonly MAIN_VITE_MICROSOFT_OAUTH_CLIENT_ID?: string
  /** Azure tenant for Microsoft OAuth. Default 'common' (work + personal accounts). */
  readonly MAIN_VITE_MICROSOFT_TENANT?: string
}
