// Expires payment sessions and cancels abandoned unpaid orders. Runs in the app process (started from
// apps/admin-ui/src/server.ts); sessions are claimed with SKIP LOCKED, so several app instances can run it.
import type { Conn } from '@shopnex/db'
import { log } from './log'
import { expireDue } from './sessions'

const POLL_MS = 30_000

const globalForWorker = globalThis as unknown as { paymentsWorker?: { stop: () => void } }

/** Starts the loop once per process (dev hot reloads reuse it). Returns a stop function. */
export function startPaymentsWorker(conn: Conn) {
  if (globalForWorker.paymentsWorker) return globalForWorker.paymentsWorker.stop
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const loop = async () => {
    try {
      await expireDue(undefined, conn)
    } catch (error) {
      log.error({ err: error }, 'expiry worker failed')
    }
    if (!stopped) timer = setTimeout(() => void loop(), POLL_MS)
  }
  timer = setTimeout(() => void loop(), POLL_MS)
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    globalForWorker.paymentsWorker = undefined
  }
  globalForWorker.paymentsWorker = { stop }
  return stop
}
