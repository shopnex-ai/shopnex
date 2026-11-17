// Business logic only — no HTTP / oRPC / Hono imports in this module (outbound calls to apps aside).
// Payment sessions: ShopNex decides the amount, the app reports the outcome, ShopNex changes the order.
// Calls to apps happen after the transaction that created the session commits: no row lock is held while
// waiting on the network, and the app may call resolve before it even answers.
import { and, desc, eq, gt, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { schema, type Conn } from '@shopnex/db'
import {
  signPaymentsRequest,
  type PaymentSessionRequest,
  type RefundSessionRequest,
} from '@shopnex/marketplace-sdk/payments'
import { instanceSigner, instanceUrl, serverUrl } from '@shopnex/apps'
import { notify } from '@shopnex/email'
import { OrderError, orderService, type CancelInput } from '@shopnex/orders'
import { emit } from '@shopnex/webhooks'
import { PaymentError } from './payments.errors'
import { log } from './log'
import { only } from './rows'
import { paymentSessions, paymentMethods, type PaymentSession } from './payments.schema'
import { appInstallations } from '@shopnex/apps/schema'
import { shops } from '@shopnex/core/schema'

// The buyer has an hour to pay; after that the unpaid order is cancelled and its stock released
const PAYMENT_TTL_MS = 60 * 60_000
const REFUND_TTL_MS = 24 * 3600_000
// A pending session with less time left than this isn't handed out again: start a fresh one
const REUSE_MIN_MS = 10 * 60_000
const TIMEOUT_MS = 15_000

// Requests only go to an app that's still installed on the shop
async function installed(conn: Conn, shopId: string, appId: string) {
  const [row] = await conn
    .select({ id: appInstallations.id })
    .from(appInstallations)
    .where(
      and(
        eq(appInstallations.shopId, shopId),
        eq(appInstallations.appId, appId),
        isNull(appInstallations.uninstalledAt),
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
  if (!res.ok) throw new Error(`${String(res.status)} ${text.slice(0, 300) || res.statusText}`)
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
    .update(paymentSessions)
    .set({ status, errorMessage, updatedAt: new Date() })
    .where(eq(paymentSessions.id, id))
}

/** The previous attempt when it can be handed out again: pending, with a redirect URL, for the method asked for (or any), and time left to pay */
function reusable(last: PaymentSession | undefined, paymentMethodId: string | undefined): PaymentSession | null {
  if (!last) return null
  const usable =
    last.status === 'pending' &&
    Boolean(last.redirectUrl) &&
    (!paymentMethodId || paymentMethodId === last.paymentMethodId) &&
    last.expiresAt.getTime() - Date.now() > REUSE_MIN_MS
  return usable ? last : null
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
  conn: Conn,
): Promise<PaymentSession> {
  // Read before the transaction opens: it queries through `db`, and on the embedded database (one connection) a query
  // that doesn't use `tx` waits for the transaction, which waits for it, so the whole shop freezes
  const instance = await instanceUrl()
  const prepared = await conn.transaction(async (tx) => {
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
      .from(paymentSessions)
      .where(and(eq(paymentSessions.orderId, orderId), eq(paymentSessions.kind, 'payment')))
      .orderBy(desc(paymentSessions.createdAt))
      .limit(1)
    // Submitted twice, or back from the provider without paying: the same session still works
    const reuse = reusable(last, opts.paymentMethodId)
    if (reuse) return { reuse }

    const methodId = opts.paymentMethodId ?? last?.paymentMethodId
    const [method] = methodId
      ? await tx
          .select()
          .from(paymentMethods)
          .where(and(eq(paymentMethods.shopId, shopId), eq(paymentMethods.id, methodId)))
      : []
    if (method?.provider !== 'app' || !method.appId || !method.paymentSessionUrl || !method.active || !method.ready) {
      throw new PaymentError('NOT_PAYABLE', 'This payment method is no longer available')
    }
    if (!(await installed(tx, shopId, method.appId)))
      throw new PaymentError('NOT_PAYABLE', 'This payment method is no longer available')

    // One open attempt at a time
    await tx
      .update(paymentSessions)
      .set({ status: 'expired', errorMessage: 'Replaced by a new payment attempt', updatedAt: new Date() })
      .where(
        and(
          eq(paymentSessions.orderId, orderId),
          eq(paymentSessions.kind, 'payment'),
          eq(paymentSessions.status, 'pending'),
        ),
      )
    const session = only(
      await tx
        .insert(paymentSessions)
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
        .returning(),
    )
    const [customer] = order.customerId
      ? await tx
          .select({ name: schema.customers.name })
          .from(schema.customers)
          .where(eq(schema.customers.id, order.customerId))
      : []
    const request: PaymentSessionRequest = {
      kind: 'payment',
      id: session.id,
      instance,
      shopId,
      orderId,
      orderNumber: order.orderNumber,
      amount: { cents: session.amountCents, currency: session.currency },
      customer: { email: order.email, name: customer?.name ?? null },
      returnUrl: opts.returnUrl,
      expiresAt: session.expiresAt.toISOString(),
    }
    return { session: session, url: method.paymentSessionUrl, request }
  })
  if (prepared.reuse) return prepared.reuse

  const { session, url, request } = prepared
  try {
    const answer = await post(url, session.id, request)
    const redirectUrl = (answer as { redirectUrl?: unknown } | null)?.redirectUrl
    if (!isHttpUrl(redirectUrl)) throw new Error('The app answered without a redirectUrl')
    const updated = only(
      await conn
        .update(paymentSessions)
        .set({ redirectUrl, updatedAt: new Date() })
        .where(eq(paymentSessions.id, session.id))
        .returning(),
    )
    return updated
  } catch (error) {
    log.error({ err: error, sessionId: session.id }, 'payment session failed')
    await close(conn, session.id, 'rejected', `Payments app unavailable: ${message(error)}`)
    throw new PaymentError('PROVIDER_UNAVAILABLE', "Payment couldn't be started. Please try again in a moment.")
  }
}

/** The order's latest payment attempt (checkout confirmation: paid / waiting / try again), or null */
export async function latestPayment(shopId: string, orderId: string, conn: Conn) {
  const [session] = await conn
    .select()
    .from(paymentSessions)
    .where(
      and(
        eq(paymentSessions.shopId, shopId),
        eq(paymentSessions.orderId, orderId),
        eq(paymentSessions.kind, 'payment'),
      ),
    )
    .orderBy(desc(paymentSessions.createdAt))
    .limit(1)
  return session ?? null
}

// --- refunds ---

/**
 * Sends the order's pending refund transactions (left by orderService.cancel for app-paid orders) to the app
 * that took the payment. A refund that can't be sent is marked failed: staff refund it at the provider.
 */
export async function startRefunds(shopId: string, orderId: string, conn: Conn) {
  const pending = await conn
    .select({ transaction: schema.orderTransactions, order: schema.orders })
    .from(schema.orderTransactions)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderTransactions.orderId))
    .leftJoin(paymentSessions, eq(paymentSessions.transactionId, schema.orderTransactions.id))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        eq(schema.orderTransactions.orderId, orderId),
        eq(schema.orderTransactions.kind, 'refund'),
        eq(schema.orderTransactions.status, 'pending'),
        isNull(paymentSessions.id),
      ),
    )
  for (const { transaction, order } of pending) {
    const [paid] = await conn
      .select({ session: paymentSessions, method: paymentMethods })
      .from(paymentSessions)
      .leftJoin(paymentMethods, eq(paymentMethods.id, paymentSessions.paymentMethodId))
      .where(
        and(
          eq(paymentSessions.orderId, orderId),
          eq(paymentSessions.kind, 'payment'),
          eq(paymentSessions.status, 'resolved'),
        ),
      )
      .orderBy(desc(paymentSessions.resolvedAt))
      .limit(1)
    const url = paid?.method?.refundSessionUrl
    const live = paid && (await installed(conn, shopId, paid.session.appId))
    const fail = (errorMessage: string) =>
      conn
        .update(schema.orderTransactions)
        .set({ status: 'failure', errorMessage, processedAt: new Date() })
        .where(eq(schema.orderTransactions.id, transaction.id))
    if (!paid || !url || !live) {
      await fail('The payments app is no longer installed: refund this payment with the provider')
      continue
    }
    const session = only(
      await conn
        .insert(paymentSessions)
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
        .returning(),
    )
    try {
      await post(url, session.id, {
        kind: 'refund',
        id: session.id,
        instance: await instanceUrl(),
        shopId,
        orderId,
        orderNumber: order.orderNumber,
        amount: { cents: session.amountCents, currency: session.currency },
        payment: { sessionId: paid.session.id, externalId: paid.session.externalId },
        expiresAt: session.expiresAt.toISOString(),
      })
    } catch (error) {
      log.error({ err: error, sessionId: session.id }, 'refund session failed')
      // The app may have resolved it while answering: only close what's still open
      const [current] = await conn
        .select({ status: paymentSessions.status })
        .from(paymentSessions)
        .where(eq(paymentSessions.id, session.id))
      if (current?.status === 'pending') {
        await close(conn, session.id, 'rejected', `Payments app unavailable: ${message(error)}`)
        await fail(`Payments app unavailable: ${message(error)}`)
      }
    }
  }
}

/** orderService.cancel, then refunds through the payments app when the order was paid through one */
export async function cancelOrder(shopId: string, orderId: string, input: CancelInput, conn: Conn) {
  const order = await orderService.cancel(shopId, orderId, input)
  await startRefunds(shopId, orderId, conn).catch((error: unknown) => {
    log.error({ err: error, orderId }, 'refunds failed')
  })
  return order
}

/** orderService.refund (part of what the order took), then sends it to the payments app when paid through one */
export async function refundOrder(shopId: string, orderId: string, input: { amountCents: number }, conn: Conn) {
  const order = await orderService.refund(shopId, orderId, input)
  await startRefunds(shopId, orderId, conn).catch((error: unknown) => {
    log.error({ err: error, orderId }, 'refunds failed')
  })
  return order
}

// --- app side: resolve / reject ---

async function lockSession(tx: Conn, shopId: string, appId: string, id: string) {
  const [session] = await tx
    .select()
    .from(paymentSessions)
    .where(and(eq(paymentSessions.shopId, shopId), eq(paymentSessions.appId, appId), eq(paymentSessions.id, id)))
    .for('update')
  if (!session) throw new PaymentError('SESSION_NOT_FOUND', 'Payment session not found')
  return session
}

/** The app's view of one of its sessions */
export async function get(shopId: string, appId: string, id: string, conn: Conn) {
  return lockSession(conn, shopId, appId, id)
}

/**
 * The provider took the money (payment) or gave it back (refund). Idempotent. An expired session still
 * resolves, and so does a rejected one (a late or racing provider event): the money is real, so the order is
 * marked paid (a cancelled order then shows as paid, for staff to refund) rather than losing the payment.
 */
export async function resolve(shopId: string, appId: string, id: string, input: { externalId?: string }, conn: Conn) {
  return conn.transaction(async (tx) => {
    const session = await lockSession(tx, shopId, appId, id)
    if (session.status === 'resolved') return session
    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, session.orderId)).for('update')
    if (!order) throw new Error('The order of the payment session is gone')
    const now = new Date()
    let transactionId = session.transactionId
    if (session.kind === 'payment') {
      const sale = only(
        await tx
          .insert(schema.orderTransactions)
          .values({
            orderId: session.orderId,
            kind: 'sale',
            status: 'success',
            gateway: order.paymentGateway ?? 'app',
            amountCents: session.amountCents,
            currency: session.currency,
            externalId: input.externalId ?? null,
          })
          .returning({ id: schema.orderTransactions.id }),
      )
      transactionId = sale.id
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
      // Refunded once everything taken is back; until then the order shows what part
      const money = await orderService.moneyOf(tx, session.orderId)
      await tx
        .update(schema.orders)
        .set({ financialStatus: money.refunded >= money.taken ? 'refunded' : 'partially_refunded', updatedAt: now })
        .where(eq(schema.orders.id, session.orderId))
    }
    const updated = only(
      await tx
        .update(paymentSessions)
        .set({
          status: 'resolved',
          externalId: input.externalId ?? null,
          transactionId,
          errorMessage: null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(paymentSessions.id, id))
        .returning(),
    )
    return updated
  })
}

/** Declined / failed at the provider. Idempotent. The buyer can try again (a new session). */
export async function reject(shopId: string, appId: string, id: string, input: { reason: string }, conn: Conn) {
  return conn.transaction(async (tx) => {
    const session = await lockSession(tx, shopId, appId, id)
    if (session.status === 'resolved') throw new PaymentError('SESSION_CLOSED', 'This session was already resolved')
    if (session.status !== 'pending') return session
    if (session.kind === 'refund' && session.transactionId) {
      await tx
        .update(schema.orderTransactions)
        .set({ status: 'failure', errorMessage: input.reason, processedAt: new Date() })
        .where(eq(schema.orderTransactions.id, session.transactionId))
    }
    const updated = only(
      await tx
        .update(paymentSessions)
        .set({ status: 'rejected', errorMessage: input.reason, updatedAt: new Date() })
        .where(eq(paymentSessions.id, id))
        .returning(),
    )
    return updated
  })
}

/**
 * A payment attempt failed at the provider (card declined…) but the buyer can still try again on the same page,
 * so the session stays open. Keeps the reason on the session. Idempotent; a closed session is left alone.
 */
export async function attemptFailed(shopId: string, appId: string, id: string, input: { reason: string }, conn: Conn) {
  return conn.transaction(async (tx) => {
    const session = await lockSession(tx, shopId, appId, id)
    if (session.status !== 'pending' || session.kind !== 'payment') return session
    const updated = only(
      await tx
        .update(paymentSessions)
        .set({ errorMessage: input.reason, updatedAt: new Date() })
        .where(eq(paymentSessions.id, id))
        .returning(),
    )
    return updated
  })
}

// --- expiry (worker) ---

/**
 * Expires sessions nobody resolved in time, then cancels unpaid orders whose payment window has passed with no
 * attempt still open (stock back on sale), like an abandoned Shopify checkout that never became an order.
 * Returns how many sessions and orders it handled.
 */
export async function expireDue(limit: number | undefined, conn: Conn) {
  limit ??= 50
  const now = new Date()
  const expired = await conn.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(paymentSessions)
      .where(and(eq(paymentSessions.status, 'pending'), lte(paymentSessions.expiresAt, now)))
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

  const later = alias(paymentSessions, 'later')
  const abandoned = await conn
    .selectDistinct({ shopId: schema.orders.shopId, orderId: schema.orders.id })
    .from(paymentSessions)
    .innerJoin(schema.orders, eq(schema.orders.id, paymentSessions.orderId))
    .where(
      and(
        eq(paymentSessions.kind, 'payment'),
        lte(paymentSessions.expiresAt, now),
        isNull(schema.orders.cancelledAt),
        eq(schema.orders.financialStatus, 'pending'),
        notExists(
          conn
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
    await orderService.cancel(shopId, orderId, { reason: 'declined', restock: true }).catch((error: unknown) => {
      log.error({ err: error, orderId }, 'cancelling the unpaid order failed')
    })
  }

  // Unpaid orders with no payment attempt open (bank transfer, or a payments app that was down at checkout) have no
  // session to expire, so they would hold their stock until the merchant cancels them by hand. A shop can set a
  // number of hours (Settings → Payments → Unpaid orders) after which they are cancelled and restocked. Orders
  // being worked on (partly or fully fulfilled) are left alone, and an order paid since it was picked is skipped.
  const open = alias(paymentSessions, 'open')
  const stale = await conn
    .select({ shopId: schema.orders.shopId, orderId: schema.orders.id })
    .from(schema.orders)
    .innerJoin(shops, eq(shops.id, schema.orders.shopId))
    .where(
      and(
        isNotNull(shops.unpaidOrderExpiryHours),
        isNull(schema.orders.cancelledAt),
        eq(schema.orders.financialStatus, 'pending'),
        eq(schema.orders.fulfillmentStatus, 'unfulfilled'),
        // created_at is written by the database clock (default now()), so compare it with the database clock
        sql`${schema.orders.createdAt} <= now() - make_interval(hours => ${shops.unpaidOrderExpiryHours})`,
        notExists(
          conn
            .select({ id: open.id })
            .from(open)
            .where(
              and(
                eq(open.orderId, schema.orders.id),
                eq(open.kind, 'payment'),
                eq(open.status, 'pending'),
                gt(open.expiresAt, now),
              ),
            ),
        ),
      ),
    )
    .limit(limit)
  let cancelled = 0
  for (const { shopId, orderId } of stale) {
    try {
      await orderService.cancel(shopId, orderId, { reason: 'other', restock: true, onlyIfUnpaid: true })
      cancelled++
    } catch (error) {
      // Paid, cancelled or fulfilled since it was picked: nothing to do
      if (!(error instanceof OrderError)) log.error({ err: error, orderId }, 'cancelling the stale unpaid order failed')
    }
  }
  return expired + abandoned.length + cancelled
}
