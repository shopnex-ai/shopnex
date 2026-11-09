// Abandoned cart reminders. The email worker calls `queueDue` every pass: it finds checkouts that still have
// an email, consent to be reminded and an idle cart, and queues the reminder in the outbox like any other email.
// A checkout is reminded once: the outbox has a unique row per cart and notification, so a second pass, a second
// app instance or a retry can't send it twice. A cart that was checked out meanwhile is never picked (its status
// is no longer `active`), and the worker checks again right before sending.
import { withStorefrontUrl } from '@shopnex/tenancy'
import { and, asc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { isSuppressed, unsubscribeToken } from './abandoned-settings'
import {
  appUrl,
  checkoutScope,
  renderEmail,
  shopScope,
  sourceOf,
  templateRows,
  type CheckoutLine,
} from './notifications'

const BATCH = 20
// A cart that went quiet longer ago than its delay plus this is left alone: turning the feature on must not mail
// every old checkout at once
const GRACE_MS = 24 * 3600_000

async function linesOf(cartId: string): Promise<CheckoutLine[]> {
  const rows = await db
    .select({ line: schema.cartLines, variant: schema.productVariants, product: schema.products })
    .from(schema.cartLines)
    .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.cartLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(and(eq(schema.cartLines.cartId, cartId), eq(schema.products.status, 'active')))
    .orderBy(asc(schema.cartLines.createdAt), asc(schema.cartLines.id))
  const productIds = [...new Set(rows.map((r) => r.product.id))]
  const images = productIds.length
    ? await db
        .select({ productId: schema.productImages.productId, url: schema.productImages.url })
        .from(schema.productImages)
        .where(and(inArray(schema.productImages.productId, productIds), eq(schema.productImages.position, 0)))
    : []
  return rows.map(({ line, variant, product }) => ({
    title: product.title,
    variantTitle: variant.optionsKey === '' ? null : variant.title,
    quantity: line.quantity,
    unitPriceCents: variant.priceCents,
    imageUrl: variant.imageUrl ?? images.find((i) => i.productId === product.id)?.url ?? null,
  }))
}

/** Carts that have waited out their shop's delay, in shops that send abandoned cart emails and haven't been reminded */
async function dueCarts() {
  const { carts, cartLines, abandonedCartSettings: settings, emailSettings, emailDeliveries } = schema
  return db
    .select({ id: carts.id })
    .from(carts)
    .innerJoin(settings, and(eq(settings.shopId, carts.shopId), eq(settings.enabled, true)))
    .innerJoin(emailSettings, and(eq(emailSettings.shopId, carts.shopId), eq(emailSettings.active, true)))
    .where(
      and(
        eq(carts.status, 'active'),
        eq(carts.reminderConsent, true),
        sql`${carts.email} is not null`,
        gt(carts.expiresAt, sql`now()`),
        lte(carts.updatedAt, sql`now() - ${settings.delayMinutes} * interval '1 minute'`),
        gte(
          carts.updatedAt,
          sql`now() - (${settings.delayMinutes} * interval '1 minute' + ${GRACE_MS} * interval '1 millisecond')`,
        ),
        sql`exists (select 1 from ${cartLines} where ${cartLines.cartId} = ${carts.id})`,
        sql`not exists (select 1 from ${emailDeliveries} where ${emailDeliveries.cartId} = ${carts.id} and ${emailDeliveries.notification} = 'abandoned_cart')`,
      ),
    )
    .orderBy(asc(carts.updatedAt))
    .limit(BATCH)
}

async function queueOne(cartId: string) {
  await db.transaction(async (tx) => {
    // Another instance may be on the same cart: whoever locks it first queues it
    const [cart] = await tx
      .select()
      .from(schema.carts)
      .where(and(eq(schema.carts.id, cartId), eq(schema.carts.status, 'active')))
      .for('update', { skipLocked: true })
    if (!cart?.email) return
    const [row] = await tx.select().from(schema.shops).where(eq(schema.shops.id, cart.shopId))
    if (!row) return
    const base = { shopId: cart.shopId, notification: 'abandoned_cart' as const, cartId: cart.id, to: cart.email }

    // Not sent: recorded as such, so the cart isn't looked at again (and starves nothing behind it)
    const skip = async (reason: string) => {
      await tx
        .insert(schema.emailDeliveries)
        .values({ ...base, subject: '', html: '', status: 'skipped', lastError: reason })
        .onConflictDoNothing()
    }
    if (await isSuppressed(tx, cart.shopId, cart.email)) return skip('Unsubscribed')
    const lines = await linesOf(cart.id)
    if (lines.length === 0) return skip('Nothing left in the cart')
    const shop = await withStorefrontUrl(row)
    const [templates, [customer]] = await Promise.all([
      templateRows(tx, cart.shopId, ['abandoned_cart', 'layout']),
      tx
        .select({ name: schema.customers.name })
        .from(schema.customers)
        .where(and(eq(schema.customers.shopId, cart.shopId), eq(schema.customers.email, cart.email))),
    ])
    const scope = {
      shop: shopScope(shop),
      ...checkoutScope(
        { token: cart.token, firstName: customer?.name?.split(' ')[0] ?? null, lines },
        `${appUrl()}/unsubscribe/${unsubscribeToken(cart.shopId, cart.email)}`,
      ),
    }
    const email = await renderEmail(
      'abandoned_cart',
      sourceOf('abandoned_cart', templates.get('abandoned_cart')),
      sourceOf('layout', templates.get('layout')).body,
      scope,
      { fallback: true },
    )
    if (email.problem) console.warn(`[email] abandoned_cart for shop ${cart.shopId}: ${email.problem.message}`)
    await tx
      .insert(schema.emailDeliveries)
      .values({ ...base, subject: email.subject, html: email.html })
      .onConflictDoNothing()
  })
}

/** One pass: queues the reminders that are due. Returns how many carts it handled. */
export async function queueDue() {
  const due = await dueCarts()
  for (const { id } of due) {
    try {
      await queueOne(id)
    } catch (error) {
      console.error(`[email] abandoned cart ${id}:`, error)
    }
  }
  return due.length
}

/**
 * Whether a queued reminder should still go out: the cart is still open and its owner hasn't unsubscribed since.
 * Returns the reason it shouldn't, or null.
 */
export async function reasonToSkip(delivery: { shopId: string; cartId: string | null; to: string }) {
  if (!delivery.cartId) return null
  const [cart] = await db
    .select({ status: schema.carts.status })
    .from(schema.carts)
    .where(eq(schema.carts.id, delivery.cartId))
  if (cart?.status !== 'active') return 'Checkout was completed'
  if (await isSuppressed(db, delivery.shopId, delivery.to)) return 'Unsubscribed'
  return null
}
