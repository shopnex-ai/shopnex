import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import type { Plan } from './checkout'
import { UsageError } from './errors'

const color = (code: number, text: string) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Something already answers on this port (IPv4 or IPv6): connecting is the check that works on every platform */
export function portInUse(port: number) {
  const tryHost = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ port, host })
      socket.setTimeout(500)
      socket.once('connect', () => (socket.destroy(), resolve(true)))
      socket.once('timeout', () => (socket.destroy(), resolve(false)))
      socket.once('error', () => resolve(false))
    })
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then((used) => used.some(Boolean))
}

/** Before starting anything: a taken port would make a server quit or move to another port, and the printed addresses would be wrong */
export async function assertPortsFree(ports: Plan['ports']) {
  for (const { port, flag } of ports) {
    if (await portInUse(port)) {
      throw new UsageError(`Port ${port} is already in use. Stop what is using it, or pick another with ${flag}.`)
    }
  }
}

async function isUp(url: string) {
  try {
    return (await fetch(url, { redirect: 'manual' })).status < 500
  } catch {
    return false
  }
}

function openBrowser(url: string) {
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {}) // no browser to open (a server, a container): the URL is printed anyway
  child.unref()
}

/**
 * Starts the planned processes, waits until they answer, prints where to open the shop, and stops them all on
 * Ctrl+C or when either exits. Resolves with the exit code.
 */
export function runPlan(plan: Plan, { open }: { open: boolean }) {
  return new Promise<number>((resolve) => {
    const children: ChildProcess[] = []
    let stopping = false

    const stop = (code: number) => {
      if (stopping) return
      stopping = true
      for (const child of children) {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM') // own process group: pnpm, vite and its workers
        } catch {
          // already gone
        }
      }
      setTimeout(() => resolve(code), 300)
    }

    for (const [index, proc] of plan.processes.entries()) {
      const child = spawn(proc.command, proc.args, {
        cwd: proc.cwd,
        env: { ...process.env, ...proc.env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      children.push(child)
      const prefix = color(index === 0 ? 36 : 35, `[${proc.name}]`.padEnd(12))
      for (const stream of [child.stdout, child.stderr]) {
        let buffer = ''
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) console.log(`${prefix} ${line}`)
        })
      }
      child.on('error', (error) => {
        console.error(`Could not start ${proc.name}: ${error.message}`)
        stop(1)
      })
      child.on('exit', (code, signal) => {
        if (stopping) return
        console.error(`${proc.name} stopped (${signal ?? `exit ${code}`}).`)
        stop(code || 1)
      })
    }

    process.on('SIGINT', () => stop(0))
    process.on('SIGTERM', () => stop(0))

    void (async () => {
      for (let i = 0; i < 180 && !stopping; i++) {
        if ((await Promise.all(plan.processes.map((proc) => isUp(proc.readyUrl)))).every(Boolean)) break
        await sleep(1000)
      }
      if (stopping) return
      const bold = (text: string) => color(1, text)
      console.log(`\n  ${color(32, '✔ ShopNex is running')}\n`)
      console.log(`  ${bold('Shop ')}  ${color(36, plan.storefrontUrl)}`)
      console.log(`  ${bold('Admin')}  ${color(36, `${plan.appUrl}/admin`)}  (first run opens the setup wizard)\n`)
      console.log(color(2, '  Create the owner account right away. Ctrl+C stops everything.\n'))
      if (open) openBrowser(`${plan.appUrl}/admin`)
    })()
  })
}
