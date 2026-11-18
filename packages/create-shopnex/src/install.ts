import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** The package manager that started create-shopnex (npm_config_user_agent starts with its name), npm when unknown */
export function packageManager(userAgent = process.env.npm_config_user_agent): Manager {
  const name = userAgent?.split('/')[0]
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm'
}

const startCommand = (manager: Manager) => (manager === 'bun' ? 'bun run start' : `${manager} start`)

/** True for a shop folder whose package.json is the one create-shopnex wrote (it lists create-shopnex) */
export function hasShopPackage(shopDir: string) {
  try {
    const pkg = JSON.parse(readFileSync(join(shopDir, 'package.json'), 'utf8'))
    return Boolean(pkg?.dependencies?.['create-shopnex'])
  } catch {
    return false
  }
}

/** The install is worth running when the shop's package.json lists create-shopnex and it is not installed yet */
export const wantsInstall = (shopDir: string) =>
  hasShopPackage(shopDir) && !existsSync(join(shopDir, 'node_modules', 'create-shopnex'))

export type Install = {
  /** What to tell the user about running the shop again, from what is known at this moment */
  nextTime: () => string
  /** Stops the install if it is still running */
  stop: () => void
}

/**
 * Installs the shop folder's dependencies (create-shopnex itself, so `npm start` works next time) in the background,
 * while the shop starts. Nothing is printed: the output goes to `onLine` (only with --verbose), a failure changes
 * nothing, and the result is told once by nextTime(). Undefined when the folder has no package.json of ours.
 */
export function setupInstall(
  shopDir: string,
  {
    enabled,
    manager = packageManager(),
    onLine,
    spawn = nodeSpawn,
  }: { enabled: boolean; manager?: Manager; onLine?: (line: string) => void; spawn?: typeof nodeSpawn },
): Install | undefined {
  if (!hasShopPackage(shopDir)) return undefined
  const again = `${manager} install, then ${startCommand(manager)}`
  const installed = existsSync(join(shopDir, 'node_modules', 'create-shopnex'))
  if (installed) return { nextTime: () => startCommand(manager), stop() {} }
  if (!enabled) return { nextTime: () => again, stop() {} }

  let state: 'running' | 'done' | 'failed' = 'running'
  let child: ChildProcess | undefined
  try {
    child = spawn(manager, ['install'], {
      cwd: shopDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // npm is npm.cmd there
    })
  } catch {
    state = 'failed'
  }
  for (const stream of [child?.stdout, child?.stderr]) {
    let buffer = ''
    stream?.on('data', (chunk: Buffer) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine?.(line)
    })
  }
  child?.on('error', () => (state = 'failed'))
  child?.on('exit', (code) => (state = code === 0 ? 'done' : 'failed'))
  return {
    nextTime: () => (state === 'done' ? startCommand(manager) : again),
    stop: () => {
      if (state === 'running') child?.kill('SIGTERM')
    },
  }
}
