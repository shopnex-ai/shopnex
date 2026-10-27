import { readFile, writeFile } from 'node:fs/promises'
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
  /** The host updater from install.sh is wired in, so this server can update itself on request */
  canUpdate: boolean
}

export type UpdateProgress = {
  state: 'running' | 'done' | 'failed'
  version: string
  step: string
  message: string
  /** Seconds since the epoch, written by the host updater */
  at: number
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

// Set only when install.sh mounted the updater's request and status folders into this container
const updaterDir = () => process.env.SHOPNEX_UPDATER_DIR || null

// Super admins only: updating is a server-level decision, and the answer is the same for every shop.
async function requireSuperAdmin(): Promise<boolean> {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  return !!session && isSuperAdmin(session.user)
}

export const getUpdateStatus = createServerFn({ method: 'GET' }).handler(async (): Promise<UpdateStatus | null> => {
  if (!(await requireSuperAdmin())) return null
  const current = process.env.APP_VERSION || null
  const none = { current, latest: null, updateAvailable: false, releaseUrl: null, canUpdate: false }
  if (process.env.SHOPNEX_UPDATE_CHECK === 'false') return none
  const release = await latestRelease()
  if (!release) return none
  const updateAvailable = current !== null && isNewer(release.tag, current)
  return {
    current,
    latest: release.tag,
    updateAvailable,
    releaseUrl: release.url,
    canUpdate: updateAvailable && updaterDir() !== null,
  }
})

// The host updater writes this file; the folder is mounted read-only here
export const getUpdateProgress = createServerFn({ method: 'GET' }).handler(async (): Promise<UpdateProgress | null> => {
  const dir = updaterDir()
  if (!dir || !(await requireSuperAdmin())) return null
  try {
    const raw = JSON.parse(await readFile(`${dir}/status/status.json`, 'utf8')) as Partial<UpdateProgress>
    if (raw.state !== 'running' && raw.state !== 'done' && raw.state !== 'failed') return null
    return {
      state: raw.state,
      version: String(raw.version ?? ''),
      step: String(raw.step ?? ''),
      message: String(raw.message ?? ''),
      at: Number(raw.at ?? 0),
    }
  } catch {
    return null
  }
})

// Asks the host updater to move to the newest release. The browser never names the version: it has to be the
// release GitHub reports as latest, and the host script checks it again before touching anything.
export const requestUpdate = createServerFn({ method: 'POST' }).handler(async (): Promise<{ requestedAt: number }> => {
  const dir = updaterDir()
  if (!dir || !(await requireSuperAdmin())) throw new Error('Updating from the dashboard is not available here.')
  const current = process.env.APP_VERSION
  const release = await latestRelease()
  if (!current || !release || !isNewer(release.tag, current)) throw new Error('This server is already up to date.')
  try {
    // 'wx' fails when a request is already waiting, so a double click cannot queue two updates
    await writeFile(`${dir}/request/pending`, release.tag, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      throw new Error('Could not reach the updater.', { cause: error })
  }
  return { requestedAt: Math.floor(Date.now() / 1000) }
})
