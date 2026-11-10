import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { Plan } from './plan'
import { UsageError } from './errors'
import { brand } from './theme'

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
export async function assertPortsFree(ports: { port: number; flag: string }[]) {
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
export function runPlan(plan: Plan, { open, verbose }: { open: boolean; verbose: boolean }) {
  return new Promise<number>((resolve) => {
    const children: ChildProcess[] = []
    const tails = new Map<string, string[]>() // the last lines of each process, shown if one fails while starting
    let stopping = false
    let ready = false
    const spinner = p.spinner()
    const animate = Boolean(process.stdout.isTTY) && !verbose
    if (animate) spinner.start('Starting ShopNex (the first start takes a minute)')
    else p.log.step('Starting ShopNex')

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
      const prefix = (index === 0 ? brand : pc.magenta)(`[${proc.name}]`.padEnd(12))
      tails.set(proc.name, [])
      for (const stream of [child.stdout, child.stderr]) {
        let buffer = ''
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (verbose) console.log(`${prefix} ${line}`)
            const tail = tails.get(proc.name) ?? []
            tail.push(line)
            if (tail.length > 40) tail.shift()
            tails.set(proc.name, tail)
          }
        })
      }
      child.on('error', (error) => {
        console.error(`Could not start ${proc.name}: ${error.message}`)
        stop(1)
      })
      child.on('exit', (code, signal) => {
        if (stopping) return
        if (animate && !ready) spinner.stop(`${proc.name} stopped`, 1)
        console.error(`${proc.name} stopped (${signal ?? `exit ${code}`}).`)
        if (!verbose) for (const line of tails.get(proc.name) ?? []) console.error(pc.dim(`  ${line}`))
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
      ready = true
      if (animate) spinner.stop('ShopNex is running')
      p.note(
        [
          `${pc.bold('Shop ')}  ${brand(plan.storefrontUrl)}`,
          `${pc.bold('Admin')}  ${brand(`${plan.appUrl}/admin`)}  (the first run opens the setup wizard)`,
        ].join('\n'),
        'Open',
      )
      p.outro('Create the owner account right away. Ctrl+C stops everything.')
      if (open) openBrowser(`${plan.appUrl}/admin`)
    })()
  })
}
