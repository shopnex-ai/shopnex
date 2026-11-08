// ShopNex's server only calls an app at the app's own origin (the one in its registered app URL): an app that could
// name any URL would be pointing the server at someone else's, or at the internal network. Payments, carrier and AI
// apps each register URLs when they configure themselves; this is the one rule they check them against.

/** The origin of an http(s) URL, or null when it is not one (a bad URL, or ftp:, javascript:…) */
export const httpOrigin = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Whether every URL is on the app's own origin, and what that origin is (for the error message). No URLs is fine;
 * an app whose own URL is not an http(s) URL has no origin, so nothing is on it.
 */
export function onAppOrigin(appUrl: string, urls: readonly string[]) {
  const appOrigin = httpOrigin(appUrl)
  return { appOrigin, ok: urls.every((url) => appOrigin !== null && httpOrigin(url) === appOrigin) }
}
