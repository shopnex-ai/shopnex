// A deploy replaces the hashed JS files, so a tab opened before it asks for a chunk that no longer exists and the route
// crashes with "Failed to fetch dynamically imported module". Reloading fetches the new build. One reload per tab per
// minute, so a chunk that is genuinely missing cannot loop.

const KEY = 'stale-chunk-reload'

export function isStaleChunkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Importing a module script failed')
  )
}

/** Reloads the page unless it already did in the last minute. Returns whether it reloaded. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function reloadOnPreloadError() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault()
  })
}
