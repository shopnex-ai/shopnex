// Sends queued notification emails (email_deliveries). Runs in the app process (started from
// apps/admin-ui/src/server.ts); rows are claimed with SKIP LOCKED, so several app instances can run it side by
// side. Same shape as the webhook delivery worker.
import { and, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import type { EmailDelivery } from '@shopnex/db/schema'
import { send } from './email'

// Wait after the nth failed attempt; one more failure after the last is final (6 attempts over ~6h)
const RETRY_DELAYS_S = [60, 5 * 60, 30 * 60, 2 * 3600, 3 * 3600]
// A claimed row is invisible to other workers this long; if this process dies mid-send it's retried after
const LEASE_MS = 120_000
const BATCH = 10
const POLL_MS = 3_000
// Finished deliveries are kept this long for the admin's list of recent emails
const RETENTION_MS = 30 * 24 * 3600_000

async function claim(): Promise<EmailDelivery[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schema.emailDeliveries.id })
      .from(schema.emailDeliveries)
      .where(and(eq(schema.emailDeliveries.status, 'pending'), lte(schema.emailDeliveries.nextAttemptAt, sql`now()`)))
      .orderBy(schema.emailDeliveries.nextAttemptAt)
      .limit(BATCH)
      .for('update', { skipLocked: true })
    if (due.length === 0) return []
    return tx
      .update(schema.emailDeliveries)
      .set({ nextAttemptAt: sql`now() + ${LEASE_MS} * interval '1 millisecond'` })
      .where(
        inArray(
          schema.emailDeliveries.id,
          due.map((d) => d.id),
        ),
      )
      .returning()
  })
}

async function attempt(delivery: EmailDelivery) {
  const now = new Date()
  const attempts = delivery.attempts + 1
  let status: EmailDelivery['status'] = 'sent'
  let lastError: string | null = null
  try {
    // Email turned off since it was queued: dropped, not retried
    const { sent } = await send(delivery.shopId, { to: delivery.to, subject: delivery.subject, html: delivery.html })
    if (!sent) {
      status = 'skipped'
      lastError = 'Email is off'
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    status = RETRY_DELAYS_S[attempts - 1] === undefined ? 'failed' : 'pending'
  }
  const retryIn = RETRY_DELAYS_S[attempts - 1] ?? 0
  await db
    .update(schema.emailDeliveries)
    .set({
      attempts,
      lastAttemptAt: now,
      lastError,
      status,
      ...(status === 'pending' && { nextAttemptAt: new Date(now.getTime() + retryIn * 1000) }),
    })
    .where(eq(schema.emailDeliveries.id, delivery.id))
}

/** One pass: sends what's due. Returns how many deliveries it handled. */
export async function processDue() {
  const deliveries = await claim()
  // One at a time: SMTP providers rate-limit bursts, and order emails aren't urgent to the second
  for (const delivery of deliveries) await attempt(delivery)
  return deliveries.length
}

async function pruneFinished() {
  await db
    .delete(schema.emailDeliveries)
    .where(
      and(
        ne(schema.emailDeliveries.status, 'pending'),
        lt(schema.emailDeliveries.createdAt, new Date(Date.now() - RETENTION_MS)),
      ),
    )
}

const globalForWorker = globalThis as unknown as { emailWorker?: { stop: () => void } }

/** Starts the polling loop once per process (dev hot reloads reuse it). Returns a stop function. */
export function startEmailWorker() {
  if (globalForWorker.emailWorker) return globalForWorker.emailWorker.stop
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let lastPrune = 0

  const loop = async () => {
    let handled = 0
    try {
      handled = await processDue()
      if (Date.now() - lastPrune > 3600_000) {
        lastPrune = Date.now()
        await pruneFinished()
      }
    } catch (error) {
      console.error('[email] delivery worker:', error)
    }
    // A full batch means more may be due: go again right away
    if (!stopped) timer = setTimeout(loop, handled === BATCH ? 0 : POLL_MS)
  }
  timer = setTimeout(loop, POLL_MS)

  const stop = () => {
    stopped = true
    clearTimeout(timer)
    globalForWorker.emailWorker = undefined
  }
  globalForWorker.emailWorker = { stop }
  return stop
}
