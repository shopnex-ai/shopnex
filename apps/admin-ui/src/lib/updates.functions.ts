import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth, isSuperAdmin } from '@shopnex/auth'

const RELEASES_URL = 'https://api.github.com/repos/shopnex-ai/shopnex/releases/latest'
const CACHE_MS = 6 * 60 * 60_000

export type UpdateStatus = {
  /** Release tag baked into this build, or null for source and branch builds */
  current: string | null
  /** Newest published release, or null when the check is off or failed */
  latest: string | null
  updateAvailable: boolean
  releaseUrl: string | null
}

type Release = { tag: string; url: string }

let cached: { at: number; release: Release | null } | undefined

// GitHub's unauthenticated API allows 60 requests an hour per IP, so remember the answer, failures included.
async function latestRelease(): Promise<Release | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.release
  let release: Release | null = null
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'shopnex-update-check' },
      signal: AbortSignal.timeout(5_000),
    })
    if (response.ok) {
      // The latest endpoint already skips pre-releases and drafts
      const body = (await response.json()) as { tag_name?: string; html_url?: string }
      if (body.tag_name && body.html_url) release = { tag: body.tag_name, url: body.html_url }
    }
  } catch {
    // Offline or blocked: show no badge rather than an error
  }
  cached = { at: Date.now(), release }
  return release
}

// "v1.2.3" -> [1, 2, 3]; anything else (a branch name, "dev", a pre-release) is not comparable
function parseVersion(tag: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

// Super admins only: updating is a server-level decision, and the answer is the same for every shop.
export const getUpdateStatus = createServerFn({ method: 'GET' }).handler(async (): Promise<UpdateStatus | null> => {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session || !isSuperAdmin(session.user)) return null
  const current = process.env.APP_VERSION || null
  const none = { current, latest: null, updateAvailable: false, releaseUrl: null }
  if (process.env.SHOPNEX_UPDATE_CHECK === 'false') return none
  const release = await latestRelease()
  if (!release) return none
  return {
    current,
    latest: release.tag,
    updateAvailable: current !== null && isNewer(release.tag, current),
    releaseUrl: release.url,
  }
})
