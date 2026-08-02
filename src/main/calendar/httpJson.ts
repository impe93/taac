/**
 * Minimal authenticated JSON GET helper for provider REST calls. Uses the global
 * `fetch` (Electron/Node) — no HTTP dependency needed.
 */
export async function getJson<T>(
  url: string,
  accessToken: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...extraHeaders
    }
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Request failed (${resp.status}) ${url}: ${body.slice(0, 300)}`)
  }
  return (await resp.json()) as T
}
