// Sends queued deliveries. Runs in the app process (started from apps/admin-ui/src/server.ts);
// rows are claimed with SKIP LOCKED, so several app instances can run it side by side.
import { and, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import type { WebhookDelivery, WebhookEndpoint } from '@shopnex/db/schema'
import { assertPublicHost } from './network'
import { signedHeaders } from './sign'

// Wait after the nth failed attempt; one more failure after the last is final (8 attempts over ~25h)
const RETRY_DELAYS_S = [60, 5 * 60, 30 * 60, 2 * 3600, 5 * 3600, 8 * 3600, 8 * 3600]
const TIMEOUT_MS = 10_000
// A claimed row is invisible to other workers this long; if this process dies mid-send it's retried after
const LEASE_MS = 60_000
const BATCH = 20
const POLL_MS = 3_000
// Finished deliveries are kept this long for the admin's delivery log
const RETENTION_MS = 30 * 24 * 3600_000

export type WorkerOptions = {
  /**
   * Allow endpoints on loopback/private addresses (e.g. a local n8n). Off in multi-tenant mode, where a
   * merchant could otherwise make the server call internal services (SSRF).
   */
  allowPrivateNetworks: boolean
  /**
   * Adds a second signature with this instance's key (v1a, Ed25519), so apps can check deliveries against the
   * instance's published keys without storing the endpoint secret. Given by the server (@shopnex/apps).
   */
  instanceSignature?: (message: string) => Promise<{ signature: string; kid: string; instance: string }>
  /** The URL to request for an endpoint URL (e.g. an app's internal address under Docker). Given by the server. */
  resolveUrl?: (url: string) => string
}

// Claims due deliveries by pushing their next attempt past the lease. "Due" uses the DB clock, the same
// one that stamped new rows, so app/DB clock skew can't hide them.
async function claim(): Promise<WebhookDelivery[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(
        and(eq(schema.webhookDeliveries.status, 'pending'), lte(schema.webhookDeliveries.nextAttemptAt, sql`now()`)),
      )
      .orderBy(schema.webhookDeliveries.nextAttemptAt)
      .limit(BATCH)
      .for('update', { skipLocked: true })
    if (due.length === 0) return []
    return tx
      .update(schema.webhookDeliveries)
      .set({ nextAttemptAt: sql`now() + ${LEASE_MS} * interval '1 millisecond'` })
      .where(
        inArray(
          schema.webhookDeliveries.id,
          due.map((d) => d.id),
        ),
      )
      .returning()
  })
}

type Result = { ok: boolean; responseStatus: number | null; error: string | null }

async function send(delivery: WebhookDelivery, endpoint: WebhookEndpoint, opts: WorkerOptions): Promise<Result> {
  try {
    const url = new URL(endpoint.url)
    if (!opts.allowPrivateNetworks) await assertPublicHost(url)
    const headers: Record<string, string> = signedHeaders(endpoint.secret, delivery.id, delivery.body)
    if (opts.instanceSignature) {
      const signed = await opts.instanceSignature(`${delivery.id}.${headers['webhook-timestamp']}.${delivery.body}`)
      headers['webhook-signature'] += ` v1a,${signed.signature}`
      headers['shopnex-instance'] = signed.instance
      headers['shopnex-key-id'] = signed.kid
    }
    const res = await fetch(opts.resolveUrl ? opts.resolveUrl(url.href) : url, {
      method: 'POST',
      headers,
      body: delivery.body,
      // A redirect isn't a success; following it would also bypass the address check
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = (await res.text().catch(() => '')).slice(0, 1000)
    return { ok: res.ok, responseStatus: res.status, error: res.ok ? null : text || res.statusText || null }
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
    return { ok: false, responseStatus: null, error: (error instanceof Error ? error.message : String(error)) + cause }
  }
}

async function attempt(delivery: WebhookDelivery, endpoint: WebhookEndpoint | undefined, opts: WorkerOptions) {
  const now = new Date()
  const attempts = delivery.attempts + 1
  const result: Result = !endpoint
    ? { ok: false, responseStatus: null, error: 'Endpoint deleted' }
    : !endpoint.active
      ? { ok: false, responseStatus: null, error: 'Endpoint disabled' }
      : await send(delivery, endpoint, opts)
  const retryIn = RETRY_DELAYS_S[attempts - 1]
  const giveUp = !endpoint?.active || retryIn === undefined
  await db
    .update(schema.webhookDeliveries)
    .set({
      attempts,
      lastAttemptAt: now,
      responseStatus: result.responseStatus,
      lastError: result.error,
      ...(result.ok
        ? { status: 'succeeded' as const }
        : giveUp
          ? { status: 'failed' as const }
          : { nextAttemptAt: new Date(now.getTime() + retryIn * 1000) }),
    })
    .where(eq(schema.webhookDeliveries.id, delivery.id))
}

/** One pass: sends what's due. Returns how many deliveries it handled. */
export async function processDue(opts: WorkerOptions) {
  const deliveries = await claim()
  if (deliveries.length === 0) return 0
  const endpointIds = [...new Set(deliveries.map((d) => d.endpointId))]
  const endpoints = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(inArray(schema.webhookEndpoints.id, endpointIds))
  const byId = new Map(endpoints.map((e) => [e.id, e]))
  await Promise.all(deliveries.map((d) => attempt(d, byId.get(d.endpointId), opts)))
  return deliveries.length
}

async function pruneFinished() {
  await db
    .delete(schema.webhookDeliveries)
    .where(
      and(
        ne(schema.webhookDeliveries.status, 'pending'),
        lt(schema.webhookDeliveries.createdAt, new Date(Date.now() - RETENTION_MS)),
      ),
    )
}

const globalForWorker = globalThis as unknown as { webhookWorker?: { stop: () => void } }

/** Starts the polling loop once per process (dev hot reloads reuse it). Returns a stop function. */
export function startDeliveryWorker(opts: WorkerOptions) {
  if (globalForWorker.webhookWorker) return globalForWorker.webhookWorker.stop
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let lastPrune = 0

  const loop = async () => {
    let handled = 0
    try {
      handled = await processDue(opts)
      if (Date.now() - lastPrune > 3600_000) {
        lastPrune = Date.now()
        await pruneFinished()
      }
    } catch (error) {
      console.error('[webhooks] delivery worker:', error)
    }
    // A full batch means more may be due: go again right away
    if (!stopped) timer = setTimeout(loop, handled === BATCH ? 0 : POLL_MS)
  }
  timer = setTimeout(loop, POLL_MS)

  const stop = () => {
    stopped = true
    clearTimeout(timer)
    globalForWorker.webhookWorker = undefined
  }
  globalForWorker.webhookWorker = { stop }
  return stop
}
