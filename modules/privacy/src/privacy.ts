// Personal data of one customer, for the two things the GDPR asks a shop to do on request: hand over what it holds
// (export) and remove it (erase). Business logic only; every query is scoped by shopId.
//
// Erase anonymizes instead of deleting where the shop has to keep its books: an order stays (number, date, items, totals,
// tax, payments, shipping country) but loses who it was for. Everything else that identifies the person goes.
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { all, type Conn } from '@shopnex/db'
import { session } from '@shopnex/auth/schema'
import { webhookDeliveries } from '@shopnex/webhooks/schema'
import { emit } from '@shopnex/webhooks'
import { shopMembers } from '@shopnex/tenancy/schema'
import { user as userTable } from '@shopnex/core/schema'
import { emailDeliveries, emailSuppressions } from '@shopnex/email/schema'
import { cartLines as cartLinesTable, carts as cartsTable } from '@shopnex/cart/schema'
import { orderItems, orders as ordersTable, orderShippingLines, orderTransactions } from '@shopnex/orders/schema'
import { customers } from '@shopnex/customers/schema'
import { giftCards } from '@shopnex/gift-cards/schema'

export type PrivacyErrorCode = 'CUSTOMER_NOT_FOUND' | 'HAS_OPEN_ORDERS'

export class PrivacyError extends Error {
  constructor(
    readonly code: PrivacyErrorCode,
    message: string,
    readonly data: { orderNumbers?: number[] } = {},
  ) {
    super(message)
    this.name = 'PrivacyError'
  }
}

/** What an anonymized order carries instead of the buyer's email, and what stands in for a name or street */
export const ERASED_EMAIL = 'erased@erased.invalid'
export const ERASED_TEXT = '(erased)'

// An order the shop may still have to deliver, collect or chase: it needs the buyer's details. Cancelled orders never do.
const isOpen = (o: { cancelledAt: Date | null; fulfillmentStatus: string; financialStatus: string }) =>
  !o.cancelledAt &&
  (o.fulfillmentStatus !== 'fulfilled' || ['pending', 'authorized', 'partially_paid'].includes(o.financialStatus))

// The customer's orders: linked to the record, or placed with the same address
const theirOrders = (shopId: string, customerId: string, email: string) =>
  and(
    eq(ordersTable.shopId, shopId),
    or(eq(ordersTable.customerId, customerId), eq(sql`lower(${ordersTable.email})`, email)),
  )
const theirCarts = (shopId: string, customerId: string, email: string) =>
  and(
    eq(cartsTable.shopId, shopId),
    or(eq(cartsTable.customerId, customerId), eq(sql`lower(${cartsTable.email})`, email)),
  )

/** Everything the shop holds about this customer, as plain data a person (or another system) can read */
export async function exportData(shopId: string, customerId: string, conn: Conn) {
  const [customer] = await conn
    .select()
    .from(customers)
    .where(and(eq(customers.shopId, shopId), eq(customers.id, customerId)))
  if (!customer) return null
  const email = customer.email.toLowerCase()

  const orders = await conn
    .select()
    .from(ordersTable)
    .where(theirOrders(shopId, customerId, email))
    .orderBy(ordersTable.orderNumber)
  const orderIds = orders.map((o) => o.id)
  const [items, shippingLines, transactions] = orderIds.length
    ? await all(conn, [
        () => conn.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
        () => conn.select().from(orderShippingLines).where(inArray(orderShippingLines.orderId, orderIds)),
        () => conn.select().from(orderTransactions).where(inArray(orderTransactions.orderId, orderIds)),
      ])
    : [[], [], []]

  const carts = await conn
    .select()
    .from(cartsTable)
    .where(theirCarts(shopId, customerId, email))
  const cartIds = carts.map((c) => c.id)
  const cartLines = cartIds.length
    ? await conn.select().from(cartLinesTable).where(inArray(cartLinesTable.cartId, cartIds))
    : []

  const emails = await conn
    .select()
    .from(emailDeliveries)
    .where(and(eq(emailDeliveries.shopId, shopId), eq(sql`lower(${emailDeliveries.to})`, email)))
    .orderBy(emailDeliveries.createdAt)
  const [suppressed] = await conn
    .select()
    .from(emailSuppressions)
    .where(and(eq(emailSuppressions.shopId, shopId), eq(emailSuppressions.email, email)))

  // Gift cards sent to them (the code stays out: it is a secret that spends the card)
  const cards = await conn
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.shopId, shopId), eq(sql`lower(${giftCards.recipientEmail})`, email)))
    .orderBy(giftCards.createdAt)

  // The storefront login, when the customer has one
  const login = customer.userId ? await conn.select().from(userTable).where(eq(userTable.id, customer.userId)) : []
  const sessions = customer.userId ? await conn.select().from(session).where(eq(session.userId, customer.userId)) : []

  return {
    schemaVersion: 1 as const,
    exportedAt: new Date(),
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      customFields: customer.customFields,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    },
    loginAccount: login[0]
      ? {
          name: login[0].name,
          email: login[0].email,
          emailVerified: login[0].emailVerified,
          createdAt: login[0].createdAt,
          sessions: sessions.map((s) => ({
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
          })),
        }
      : null,
    giftCards: cards.map((g) => ({
      id: g.id,
      currency: g.currency,
      initialCents: g.initialCents,
      balanceCents: g.balanceCents,
      recipientEmail: g.recipientEmail,
      expiresAt: g.expiresAt,
      createdAt: g.createdAt,
    })),
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      email: o.email,
      phone: o.phone,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      cancelledAt: o.cancelledAt,
      currency: o.currency,
      subtotalCents: o.subtotalCents,
      shippingCents: o.shippingCents,
      taxCents: o.taxCents,
      discountCents: o.discountCents,
      totalCents: o.totalCents,
      taxLines: o.taxLines,
      discountCodes: o.discountCodes,
      shippingAddress: o.shippingAddress,
      billingAddress: o.billingAddress,
      paymentMethod: o.paymentMethodName,
      note: o.note,
      customFields: o.customFields,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => ({
          title: i.title,
          variantTitle: i.variantTitle,
          sku: i.sku,
          unitPriceCents: i.unitPriceCents,
          quantity: i.quantity,
          discountCents: i.discountCents,
        })),
      shippingLines: shippingLines
        .filter((s) => s.orderId === o.id)
        .map((s) => ({ title: s.title, priceCents: s.priceCents, discountCents: s.discountCents })),
      transactions: transactions
        .filter((t) => t.orderId === o.id)
        .map((t) => ({ kind: t.kind, status: t.status, amountCents: t.amountCents, currency: t.currency })),
    })),
    carts: carts.map((c) => ({
      createdAt: c.createdAt,
      status: c.status,
      email: c.email,
      lines: cartLines.filter((l) => l.cartId === c.id).map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    })),
    emails: emails.map((e) => ({
      notification: e.notification,
      to: e.to,
      subject: e.subject,
      html: e.html,
      status: e.status,
      createdAt: e.createdAt,
    })),
    unsubscribedFromReminders: Boolean(suppressed),
  }
}

/**
 * Removes the customer's personal data and keeps what the shop's books need. Refused while the customer has an order
 * that is still to be delivered, paid or cancelled: it needs their address. Nothing is half done (one transaction).
 */
export async function erase(shopId: string, customerId: string, conn: Conn) {
  const result = await conn.transaction(async (tx) => {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.shopId, shopId), eq(customers.id, customerId)))
      .for('update')
    if (!customer) throw new PrivacyError('CUSTOMER_NOT_FOUND', 'Customer not found')
    const email = customer.email.toLowerCase()

    const orders = await tx
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        cancelledAt: ordersTable.cancelledAt,
        fulfillmentStatus: ordersTable.fulfillmentStatus,
        financialStatus: ordersTable.financialStatus,
      })
      .from(ordersTable)
      .where(theirOrders(shopId, customerId, email))
    const open = orders.filter(isOpen)
    if (open.length > 0) {
      const numbers = open.map((o) => o.orderNumber).sort((a, b) => a - b)
      throw new PrivacyError(
        'HAS_OPEN_ORDERS',
        `This customer has orders that are not finished: ${numbers.map((n) => `#${String(n)}`).join(', ')}. Fulfil or cancel them first.`,
        { orderNumbers: numbers },
      )
    }
    const orderIds = orders.map((o) => o.id)

    // Orders: who they were for goes; the shipping country and region stay (tax is reported by place of delivery)
    const anonymousAddress = (column: typeof ordersTable.shippingAddress | typeof ordersTable.billingAddress) => sql`
      case when ${column} is null then null else jsonb_build_object(
        'firstName', null, 'lastName', null, 'company', null,
        'address1', ${ERASED_TEXT}::text, 'address2', null, 'city', ${ERASED_TEXT}::text,
        'province', ${column}->'province', 'countryCode', ${column}->'countryCode',
        'zip', null, 'phone', null) end`
    if (orderIds.length > 0) {
      await tx
        .update(ordersTable)
        .set({
          email: ERASED_EMAIL,
          phone: null,
          note: null,
          shippingAddress: anonymousAddress(ordersTable.shippingAddress),
          billingAddress: anonymousAddress(ordersTable.billingAddress),
          updatedAt: new Date(),
        })
        .where(inArray(ordersTable.id, orderIds))
    }

    // Carts: the address a checkout was started with
    const carts = await tx
      .update(cartsTable)
      .set({ email: null, customerId: null })
      .where(theirCarts(shopId, customerId, email))
      .returning({ id: cartsTable.id })
    const cartIds = carts.map((c) => c.id)

    // Stored emails: the ones sent to this person lose recipient, subject and body. Copies sent to the shop about this
    // person's orders (the "new order" mail) lose the body, which carries the buyer's details. The row stays so a
    // notification is never sent twice.
    const mine = eq(sql`lower(${emailDeliveries.to})`, email)
    const aboutThem = or(
      mine,
      orderIds.length > 0 ? inArray(emailDeliveries.orderId, orderIds) : undefined,
      cartIds.length > 0 ? inArray(emailDeliveries.cartId, cartIds) : undefined,
    )
    const toThem = await tx
      .update(emailDeliveries)
      .set({
        to: sql`'erased-' || ${emailDeliveries.id} || '@erased.invalid'`,
        subject: ERASED_TEXT,
        html: '',
        lastError: null,
      })
      .where(and(eq(emailDeliveries.shopId, shopId), mine))
      .returning({ id: emailDeliveries.id })
    const aboutThemOnly = await tx
      .update(emailDeliveries)
      .set({ html: '', lastError: null })
      .where(and(eq(emailDeliveries.shopId, shopId), aboutThem))
      .returning({ id: emailDeliveries.id })

    // Gift cards sent to them keep their balance (the shop owes it to whoever holds the code) but lose who they were for
    await tx
      .update(giftCards)
      .set({ recipientEmail: null, updatedAt: new Date() })
      .where(and(eq(giftCards.shopId, shopId), eq(sql`lower(${giftCards.recipientEmail})`, email)))

    // Webhook history: payloads of events about this person (kept 30 days for retries and the log)
    const deliveries = await tx
      .delete(webhookDeliveries)
      .where(and(eq(webhookDeliveries.shopId, shopId), sql`strpos(lower(${webhookDeliveries.body}), ${email}) > 0`))
      .returning({ id: webhookDeliveries.id })

    await tx.delete(customers).where(eq(customers.id, customerId))

    // The storefront login goes with the customer, unless it is also someone else's: staff of any shop, a platform
    // admin, or the customer of another shop (one login can serve several)
    let loginAccountDeleted = false
    if (customer.userId) {
      const [user] = await tx.select().from(userTable).where(eq(userTable.id, customer.userId))
      const [staff] = await tx
        .select({ id: shopMembers.id })
        .from(shopMembers)
        .where(eq(shopMembers.userId, customer.userId))
        .limit(1)
      const [elsewhere] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.userId, customer.userId))
        .limit(1)
      if (user && !staff && !elsewhere && user.role !== 'superadmin') {
        await tx.delete(userTable).where(eq(userTable.id, customer.userId))
        loginAccountDeleted = true
      }
    }

    // After the cleaning above, so this event's own payload (it names the person, so receivers can find their copy)
    // is not swept up with the rest
    await emit(tx, shopId, 'customer.erased', () => ({ id: customerId, email: customer.email }))

    return {
      ordersAnonymized: orderIds.length,
      cartsCleared: cartIds.length,
      emailsRedacted: new Set([...toThem, ...aboutThemOnly].map((e) => e.id)).size,
      webhookDeliveriesDeleted: deliveries.length,
      loginAccountDeleted,
    }
  })
  return result
}
