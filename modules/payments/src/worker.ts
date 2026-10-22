// Expires payment sessions and cancels abandoned unpaid orders. Runs in the app process (started from
// apps/admin-ui/src/server.ts); sessions are claimed with SKIP LOCKED, so several app instances can run it.
import { expireDue } from './sessions'

const POLL_MS = 30_000

const globalForWorker = globalThis as unknown as { paymentsWorker?: { stop: () => void } }

/** Starts the loop once per process (dev hot reloads reuse it). Returns a stop function. */
export function startPaymentsWorker() {
  if (globalForWorker.paymentsWorker) return globalForWorker.paymentsWorker.stop
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const loop = async () => {
    try {
      await expireDue()
    } catch (error) {
      console.error('[payments] expiry worker:', error)
    }
    if (!stopped) timer = setTimeout(loop, POLL_MS)
  }
  timer = setTimeout(loop, POLL_MS)
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    globalForWorker.paymentsWorker = undefined
  }
  globalForWorker.paymentsWorker = { stop }
  return stop
}
