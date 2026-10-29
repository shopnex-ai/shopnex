// Apps are reached by browsers at their public URL (STRIPE_APP_URL). Under Docker that address is often not
// reachable from the Shopnex container itself (localhost is the container), so the operator can name the address
// the server uses instead: <NAME>_APP_INTERNAL_URL next to <NAME>_APP_URL, e.g. http://stripe:4600.
// Only operator config is ever consulted, never anything an app or a merchant supplies.

/** The URL Shopnex's server should request for an app URL: swaps the origin when an internal one is configured */
export function serverUrl(url: string): string {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return url
  }
  for (const [name, value] of Object.entries(process.env)) {
    const prefix = name.match(/^(.+)_APP_URL$/)?.[1]
    const internal = prefix && process.env[`${prefix}_APP_INTERNAL_URL`]?.trim()
    if (!value || !internal) continue
    try {
      if (new URL(value).origin !== target.origin) continue
      const to = new URL(internal)
      target.protocol = to.protocol
      target.host = to.host
      // new URL() adds a slash to a bare origin; callers append paths to it
      const swapped = target.toString()
      return url.endsWith('/') ? swapped : swapped.replace(/\/$/, '')
    } catch {
      continue
    }
  }
  return url
}
