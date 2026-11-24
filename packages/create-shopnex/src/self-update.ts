import { spawn } from 'node:child_process'
import { isEdge } from '@shopnex/cli-core/bundle'

/** Set on the re-run, so the newer copy does not check (and re-run) again */
export const UPDATED_ENV = 'CREATE_SHOPNEX_UPDATED'

const REGISTRY_URL = 'https://registry.npmjs.org/create-shopnex/latest'
const CHECK_TIMEOUT_MS = 1500

/** "1.2.3" → [1, 2, 3]; undefined for anything else (a prerelease such as 1.2.3-edge.x is not a release) */
function release(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? match.slice(1).map(Number) : undefined
}

/** Whether `latest` is a newer release than `current` */
export function isNewer(latest: string, current: string) {
  const a = release(latest)
  const b = release(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** No check from a checkout, an edge build, CI, the re-run itself or when the user asked not to */
export function shouldCheck({
  version,
  fromSource,
  disabled,
  env,
}: {
  version: string
  fromSource: boolean
  disabled: boolean
  env: NodeJS.ProcessEnv
}) {
  if (fromSource || disabled || isEdge(version)) return false
  return !env[UPDATED_ENV] && !env.CI
}

/** The newest published version when it is newer than `current`; undefined when it is not, or on any failure (offline, slow) */
export async function newerVersion(current: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetcher(REGISTRY_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (!response.ok) return undefined
    const { version } = (await response.json()) as { version?: unknown }
    return typeof version === 'string' && isNewer(version, current) ? version : undefined
  } catch {
    return undefined
  }
}

/** Runs the newer create-shopnex with the same arguments and resolves with its exit code */
export function rerun(version: string, argv: string[]) {
  return new Promise<number>((resolve) => {
    const child = spawn('npx', ['--yes', `create-shopnex@${version}`, ...argv], {
      stdio: 'inherit',
      env: { ...process.env, [UPDATED_ENV]: '1' },
      shell: process.platform === 'win32',
    })
    // npx could not start: carry on with this version instead
    child.on('error', () => resolve(-1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}
