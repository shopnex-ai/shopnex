// Business logic only — no HTTP / oRPC / Hono imports in this module (outbound calls to apps aside).
// Payment sessions: Shopnex decides the amount, the app reports the outcome, Shopnex changes the order.
// Calls to apps happen after the transaction that created the session commits: no row lock is held while
// waiting on the network, and the app may call resolve before it even answers.
import { and, desc, eq, gt, isNull, lte, notExists, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, schema, type Conn } from '@shopnex/db'
import type { PaymentSession } from '@shopnex/db/schema'
import {
  signPaymentsRequest,
  type PaymentSessionRequest,
  type RefundSessionRequest,
} from '@shopnex/marketplace-sdk/payments'
import { instanceSigner, instanceUrl, serverUrl } from '@shopnex/apps'
import { notify } from '@shopnex/email'
import { orderService, type CancelInput } from '@shopnex/orders'
import { emit } from '@shopnex/webhooks'
import { PaymentError } from './errors'

// The buyer has an hour to pay; after that the unpaid order is cancelled and its stock released
const PAYMENT_TTL_MS = 60 * 60_000
const REFUND_TTL_MS = 24 * 3600_000
// A pending session with less time left than this isn't handed out again: start a fresh one
const REUSE_MIN_MS = 10 * 60_000
const TIMEOUT_MS = 15_000

// Requests only go to an app that's still installed on the shop
async function installed(conn: Conn, shopId: string, appId: string) {
  const [row] = await conn
    .select({ id: schema.appInstallations.id })
    .from(schema.appInstallations)
    .where(
      and(
        eq(schema.appInstallations.shopId, shopId),
        eq(schema.appInstallations.appId, appId),
        isNull(schema.appInstallations.uninstalledAt),
      ),
    )
  return Boolean(row)
}

// Signed with this instance's key; the app checks it against our published keys (`instance` in the body)
async function post(url: string, id: string, payload: PaymentSessionRequest | RefundSessionRequest) {
  const body = JSON.stringify(payload)
  const res = await fetch(serverUrl(url), {
    method: 'POST',
    headers: await signPaymentsRequest(await instanceSigner(), id, body),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300) || res.statusText}`)
  try {
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const isHttpUrl = (value: unknown): value is string => {
  try {
    return typeof value === 'string' && /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

async function close(conn: Conn, id: string, status: 'rejected' | 'expired', errorMessage: string) {
  await conn
    .update(schema.paymentSessions)
    .set({ status, errorMessage, updatedAt: new Date() })
    .where(eq(schema.paymentSessions.id, id))
}

// --- payments ---

/**
 * Starts (or picks up) the payment of an unpaid order through its payments app and returns the session, whose
 * redirectUrl is where the buyer pays. `paymentMethodId` defaults to the method of the order's last attempt.
 * Throws NOT_PAYABLE (paid, cancelled, method gone) or PROVIDER_UNAVAILABLE (the app didn't answer).
 */
export async function startPayment(
  shopId: string,
  orderId: string,
  opts: { returnUrl: string; paymentMethodId?: string },
): Promise<PaymentSession> {
  const prepared = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.id, orderId)))
      .for('update')
    if (!order) throw new PaymentError('NOT_PAYABLE', 'Order not found')
    if (order.cancelledAt) throw new PaymentError('NOT_PAYABLE', 'This order was cancelled')
    if (order.financialStatus !== 'pending') throw new PaymentError('NOT_PAYABLE', 'This order is already paid')

    const [last] = await tx
      .select()
      .from(schema.paymentSessions)
      .where(and(eq(schema.paymentSessions.orderId, orderId), eq(schema.paymentSessions.kind, 'payment')))
      .orderBy(desc(schema.paymentSessions.createdAt))
      .limit(1)
    // Submitted twice, or back from the provider without paying: the same session still works
    if (
      last?.status === 'pending' &&
      last.redirectUrl &&
      (!opts.paymentMethodId || opts.paymentMethodId === last.paymentMethodId) &&
      last.expiresAt.getTime() - Date.now() > REUSE_MIN_MS
    ) {
      return { reuse: last }
    }

    const methodId = opts.paymentMethodId ?? last?.paymentMethodId
    const [method] = methodId
      ? await tx
          .select()
          .from(schema.paymentMethods)
          .where(and(eq(schema.paymentMethods.shopId, shopId), eq(schema.paymentMethods.id, methodId)))
      : []
    if (
      !method ||
      method.provider !== 'app' ||
      !method.appId ||
      !method.paymentSessionUrl ||
      !method.active ||
      !method.ready
    ) {
      throw new PaymentError('NOT_PAYABLE', 'This payment method is no longer available')
    }
    if (!(await installed(tx, shopId, method.appId)))
      throw new PaymentError('NOT_PAYABLE', 'This payment method is no longer available')

    // One open attempt at a time
    await tx
      .update(schema.paymentSessions)
      .set({ status: 'expired', errorMessage: 'Replaced by a new payment attempt', updatedAt: new Date() })
      .where(
        and(
          eq(schema.paymentSessions.orderId, orderId),
          eq(schema.paymentSessions.kind, 'payment'),
          eq(schema.paymentSessions.status, 'pending'),
        ),
      )
    const [session] = await tx
      .insert(schema.paymentSessions)
      .values({
        shopId,
        orderId,
        appId: method.appId,
        paymentMethodId: method.id,
        kind: 'payment',
        amountCents: order.totalCents,
        currency: order.currency,
        expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
      })
      .returning()
    const [customer] = order.customerId
      ? await tx
          .select({ name: schema.customers.name })
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : []
    const request: PaymentSessionRequest = {
      kind: 'payment',
      id: session!.id,
      instance: await instanceUrl(),
      shopId,
      orderId,
      orderNumber: order.orderNumber,
      amount: { cents: session!.amountCents, currency: session!.currency },
      customer: { email: order.email, name: customer?.name ?? null },
      returnUrl: opts.returnUrl,
      expiresAt: session!.expiresAt.toISOString(),
    }
    return { session: session!, url: method.paymentSessionUrl, request }
  })
  if ('reuse' in prepared) return prepared.reuse!

  const { session, url, request } = prepared
  try {
    const answer = await post(url, session.id, request)
    const redirectUrl = (answer as { redirectUrl?: unknown } | null)?.redirectUrl
    if (!isHttpUrl(redirectUrl)) throw new Error('The app answered without a redirectUrl')
    const [updated] = await db
      .update(schema.paymentSessions)
      .set({ redirectUrl, updatedAt: new Date() })
      .where(eq(schema.paymentSessions.id, session.id))
      .returning()
    return updated!
  } catch (error) {
    console.error(`[payments] payment session ${session.id}:`, message(error))
    await close(db, session.id, 'rejected', `Payments app unavailable: ${message(error)}`)
    throw new PaymentError('PROVIDER_UNAVAILABLE', "Payment couldn't be started. Please try again in a moment.")
  }
}

/** The order's latest payment attempt (checkout confirmation: paid / waiting / try again), or null */
export async function latestPayment(shopId: string, orderId: string) {
  const [session] = await db
    .select()
    .from(schema.paymentSessions)
    .where(
      and(
        eq(schema.paymentSessions.shopId, shopId),
        eq(schema.paymentSessions.orderId, orderId),
        eq(schema.paymentSessions.kind, 'payment'),
      ),
    )
    .orderBy(desc(schema.paymentSessions.createdAt))
    .limit(1)
  return session ?? null
}

// --- refunds ---

/**
 * Sends the order's pending refund transactions (left by orderService.cancel for app-paid orders) to the app
 * that took the payment. A refund that can't be sent is marked failed: staff refund it at the provider.
 */
export async function startRefunds(shopId: string, orderId: string) {
  const pending = await db
    .select({ transaction: schema.orderTransactions, order: schema.orders })
    .from(schema.orderTransactions)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderTransactions.orderId))
    .leftJoin(schema.paymentSessions, eq(schema.paymentSessions.transactionId, schema.orderTransactions.id))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        eq(schema.orderTransactions.orderId, orderId),
        eq(schema.orderTransactions.kind, 'refund'),
        eq(schema.orderTransactions.status, 'pending'),
        isNull(schema.paymentSessions.id),
      ),
    )
  for (const { transaction, order } of pending) {
    const [paid] = await db
      .select({ session: schema.paymentSessions, method: schema.paymentMethods })
      .from(schema.paymentSessions)
      .leftJoin(schema.paymentMethods, eq(schema.paymentMethods.id, schema.paymentSessions.paymentMethodId))
      .where(
        and(
          eq(schema.paymentSessions.orderId, orderId),
          eq(schema.paymentSessions.kind, 'payment'),
          eq(schema.paymentSessions.status, 'resolved'),
        ),
      )
      .orderBy(desc(schema.paymentSessions.resolvedAt))
      .limit(1)
    const url = paid?.method?.refundSessionUrl
    const live = paid && (await installed(db, shopId, paid.session.appId))
    const fail = (errorMessage: string) =>
      db
        .update(schema.orderTransactions)
        .set({ status: 'failure', errorMessage, processedAt: new Date() })
        .where(eq(schema.orderTransactions.id, transaction.id))
    if (!paid || !url || !live) {
      await fail('The payments app is no longer installed: refund this payment with the provider')
      continue
    }
    const [session] = await db
      .insert(schema.paymentSessions)
      .values({
        shopId,
        orderId,
        appId: paid.session.appId,
        paymentMethodId: paid.session.paymentMethodId,
        kind: 'refund',
        amountCents: transaction.amountCents,
        currency: transaction.currency,
        transactionId: transaction.id,
        expiresAt: new Date(Date.now() + REFUND_TTL_MS),
      })
      .returning()
    try {
      await post(url, session!.id, {
        kind: 'refund',
        id: session!.id,
        instance: await instanceUrl(),
        shopId,
        orderId,
        orderNumber: order.orderNumber,
        amount: { cents: session!.amountCents, currency: session!.currency },
        payment: { sessionId: paid.session.id, externalId: paid.session.externalId },
        expiresAt: session!.expiresAt.toISOString(),
      })
    } catch (error) {
      console.error(`[payments] refund session ${session!.id}:`, message(error))
      // The app may have resolved it while answering: only close what's still open
      const [current] = await db
        .select({ status: schema.paymentSessions.status })
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, session!.id))
      if (current?.status === 'pending') {
        await close(db, session!.id, 'rejected', `Payments app unavailable: ${message(error)}`)
        await fail(`Payments app unavailable: ${message(error)}`)
      }
    }
  }
}

/** orderService.cancel, then refunds through the payments app when the order was paid through one */
export async function cancelOrder(shopId: string, orderId: string, input: CancelInput) {
  const order = await orderService.cancel(shopId, orderId, input)
  await startRefunds(shopId, orderId).catch((error) => console.error('[payments] refunds:', error))
  return order
}

// --- app side: resolve / reject ---

async function lockSession(tx: Conn, shopId: string, appId: string, id: string) {
  const [session] = await tx
    .select()
    .from(schema.paymentSessions)
    .where(
      and(
        eq(schema.paymentSessions.shopId, shopId),
        eq(schema.paymentSessions.appId, appId),
        eq(schema.paymentSessions.id, id),
      ),
    )
    .for('update')
  if (!session) throw new PaymentError('SESSION_NOT_FOUND', 'Payment session not found')
  return session
}

/** The app's view of one of its sessions */
export async function get(shopId: string, appId: string, id: string) {
  return lockSession(db, shopId, appId, id)
}

/**
 * The provider took the money (payment) or gave it back (refund). Idempotent. An expired session still
 * resolves: the buyer paid just as Shopnex gave up waiting, and that money is real (a cancelled order then
 * shows as paid, for staff to refund).
 */
export async function resolve(shopId: string, appId: string, id: string, input: { externalId?: string }) {
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, shopId, appId, id)
    if (session.status === 'resolved') return session
    if (session.status === 'rejected') throw new PaymentError('SESSION_CLOSED', 'This session was rejected')
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, session.orderId)).for('update')
    const now = new Date()
    let transactionId = session.transactionId
    if (session.kind === 'payment') {
      const [sale] = await tx
        .insert(schema.orderTransactions)
        .values({
          orderId: session.orderId,
          kind: 'sale',
          status: 'success',
          gateway: order!.paymentGateway ?? 'app',
          amountCents: session.amountCents,
          currency: session.currency,
          externalId: input.externalId ?? null,
        })
        .returning({ id: schema.orderTransactions.id })
      transactionId = sale!.id
      await tx
        .update(schema.orders)
        .set({ financialStatus: 'paid', updatedAt: now })
        .where(eq(schema.orders.id, session.orderId))
      await emit(tx, shopId, 'order.paid', () => orderService.getById(shopId, session.orderId, tx))
      await notify(tx, shopId, 'order.paid', () => orderService.getById(shopId, session.orderId, tx))
    } else {
      if (session.transactionId) {
        await tx
          .update(schema.orderTransactions)
          .set({ status: 'success', externalId: input.externalId ?? null, processedAt: now })
          .where(eq(schema.orderTransactions.id, session.transactionId))
      }
      await tx
        .update(schema.orders)
        .set({ financialStatus: 'refunded', updatedAt: now })
        .where(eq(schema.orders.id, session.orderId))
    }
    const [updated] = await tx
      .update(schema.paymentSessions)
      .set({
        status: 'resolved',
        externalId: input.externalId ?? null,
        transactionId,
        errorMessage: null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.paymentSessions.id, id))
      .returning()
    return updated!
  })
}

/** Declined / failed at the provider. Idempotent. The buyer can try again (a new session). */
export async function reject(shopId: string, appId: string, id: string, input: { reason: string }) {
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, shopId, appId, id)
    if (session.status === 'resolved') throw new PaymentError('SESSION_CLOSED', 'This session was already resolved')
    if (session.status !== 'pending') return session
    if (session.kind === 'refund' && session.transactionId) {
      await tx
        .update(schema.orderTransactions)
        .set({ status: 'failure', errorMessage: input.reason, processedAt: new Date() })
        .where(eq(schema.orderTransactions.id, session.transactionId))
    }
    const [updated] = await tx
      .update(schema.paymentSessions)
      .set({ status: 'rejected', errorMessage: input.reason, updatedAt: new Date() })
      .where(eq(schema.paymentSessions.id, id))
      .returning()
    return updated!
  })
}

// --- expiry (worker) ---

/**
 * Expires sessions nobody resolved in time, then cancels unpaid orders whose payment window has passed with no
 * attempt still open (stock back on sale), like an abandoned Shopify checkout that never became an order.
 * Returns how many sessions and orders it handled.
 */
export async function expireDue(limit = 50) {
  const now = new Date()
  const expired = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.paymentSessions)
      .where(and(eq(schema.paymentSessions.status, 'pending'), lte(schema.paymentSessions.expiresAt, now)))
      .limit(limit)
      .for('update', { skipLocked: true })
    for (const session of due) {
      await close(tx, session.id, 'expired', 'Not completed in time')
      if (session.kind === 'refund' && session.transactionId) {
        await tx
          .update(schema.orderTransactions)
          .set({ status: 'error', errorMessage: 'The payments app never confirmed this refund', processedAt: now })
          .where(eq(schema.orderTransactions.id, session.transactionId))
      }
    }
    return due.length
  })

  const later = alias(schema.paymentSessions, 'later')
  const abandoned = await db
    .selectDistinct({ shopId: schema.orders.shopId, orderId: schema.orders.id })
    .from(schema.paymentSessions)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.paymentSessions.orderId))
    .where(
      and(
        eq(schema.paymentSessions.kind, 'payment'),
        lte(schema.paymentSessions.expiresAt, now),
        isNull(schema.orders.cancelledAt),
        eq(schema.orders.financialStatus, 'pending'),
        notExists(
          db
            .select({ id: later.id })
            .from(later)
            .where(
              and(
                eq(later.orderId, schema.orders.id),
                eq(later.kind, 'payment'),
                or(eq(later.status, 'pending'), gt(later.expiresAt, now)),
              ),
            ),
        ),
      ),
    )
    .limit(limit)
  for (const { shopId, orderId } of abandoned) {
    await orderService
      .cancel(shopId, orderId, { reason: 'declined', restock: true })
      .catch((error) => console.error(`[payments] cancel unpaid order ${orderId}:`, message(error)))
  }
  return expired + abandoned.length
}
