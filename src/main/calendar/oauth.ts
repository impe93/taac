import { createServer } from 'http'
import { createHash, randomBytes } from 'crypto'
import type { AddressInfo } from 'net'
import { shell } from 'electron'
import type { OAuthTokens } from './types'

/**
 * Generic OAuth 2.0 Authorization Code + PKCE flow with a transient loopback
 * redirect (127.0.0.1 / localhost on a random port). Works uniformly for Google
 * and Microsoft public (desktop) clients — no client secret, no custom protocol,
 * no single-instance handling. See docs: Google native-app OAuth, MSAL loopback.
 */

export interface OAuthEndpoints {
  authorizeUrl: string
  tokenUrl: string
}

export interface PkceProviderConfig {
  clientId: string
  /**
   * Client secret for the token endpoint. Required by Google "Desktop app"
   * clients even with PKCE (Google documents it as NOT a real secret for
   * installed apps — it is bundled in the binary). Omitted for Microsoft public
   * clients, which reject a secret.
   */
  clientSecret?: string
  scopes: string[]
  endpoints: OAuthEndpoints
  /** Loopback host: '127.0.0.1' (Google) or 'localhost' (Microsoft). */
  redirectHost: string
  /** Extra params on the authorize request, e.g. access_type/prompt. */
  extraAuthParams?: Record<string, string>
}

const FLOW_TIMEOUT_MS = 5 * 60_000

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Taac</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0b0c;color:#e7e7e9;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#9a9aa2;margin:0}</style></head>
<body><div class="card"><h1>Calendar connected</h1><p>You can close this tab and return to Taac.</p></div>
<script>setTimeout(()=>window.close(),1200)</script></body></html>`

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
}

function parseTokenResponse(json: RawTokenResponse): OAuthTokens {
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: json.scope,
    tokenType: json.token_type,
    idToken: json.id_token
  }
}

async function exchangeCode(
  config: PkceProviderConfig,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
  if (config.clientSecret) body.set('client_secret', config.clientSecret)
  const resp = await fetch(config.endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  })
  if (!resp.ok) {
    throw new Error(`Token exchange failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`)
  }
  return parseTokenResponse((await resp.json()) as RawTokenResponse)
}

/**
 * Run the interactive PKCE flow. Opens the system browser, waits for the loopback
 * redirect, and exchanges the code for tokens.
 */
export async function runPkceLoopbackFlow(config: PkceProviderConfig): Promise<OAuthTokens> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  return new Promise<OAuthTokens>((resolvePromise, rejectPromise) => {
    let settled = false
    let redirectUri = ''

    const finish = (err: Error | null, tokens?: OAuthTokens): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.close()
      if (err) rejectPromise(err)
      else resolvePromise(tokens as OAuthTokens)
    }

    const server = createServer((req, res) => {
      void (async (): Promise<void> => {
        try {
          const reqUrl = new URL(req.url ?? '/', `http://${config.redirectHost}`)
          const code = reqUrl.searchParams.get('code')
          const returnedState = reqUrl.searchParams.get('state')
          const error = reqUrl.searchParams.get('error')

          // Ignore favicon and any non-callback noise the browser makes.
          if (!code && !error) {
            res.writeHead(204)
            res.end()
            return
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(SUCCESS_HTML)

          if (settled) return
          if (error) {
            finish(new Error(`Authorization failed: ${error}`))
            return
          }
          if (!code || returnedState !== state) {
            finish(new Error('Authorization response was invalid (state mismatch).'))
            return
          }
          const tokens = await exchangeCode(config, code, verifier, redirectUri)
          finish(null, tokens)
        } catch (e) {
          finish(e as Error)
        }
      })()
    })

    const timeout = setTimeout(() => finish(new Error('Authorization timed out.')), FLOW_TIMEOUT_MS)
    timeout.unref?.()

    server.on('error', (e) => finish(e as Error))
    server.listen(0, config.redirectHost, () => {
      const { port } = server.address() as AddressInfo
      redirectUri = `http://${config.redirectHost}:${port}`
      const authUrl = new URL(config.endpoints.authorizeUrl)
      const params: Record<string, string> = {
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: config.scopes.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        ...config.extraAuthParams
      }
      for (const [k, v] of Object.entries(params)) authUrl.searchParams.set(k, v)
      void shell.openExternal(authUrl.toString())
    })
  })
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(
  config: PkceProviderConfig,
  refreshToken: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: config.scopes.join(' ')
  })
  if (config.clientSecret) body.set('client_secret', config.clientSecret)
  const resp = await fetch(config.endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  })
  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`)
  }
  const tokens = parseTokenResponse((await resp.json()) as RawTokenResponse)
  // Providers may omit the refresh token on refresh; keep the existing one.
  if (!tokens.refreshToken) tokens.refreshToken = refreshToken
  return tokens
}
