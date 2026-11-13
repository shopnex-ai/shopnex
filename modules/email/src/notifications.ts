// Notifications: the emails ShopNex sends by itself when an order changes, rendered from the shop's Liquid
// (Settings → Notifications, built-in defaults until edited). `notify` runs inside the transaction that made the
// change and queues rendered emails in the outbox (email_deliveries); the worker sends them.
import { withStorefrontUrl } from '@shopnex/tenancy'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type {
  Customer,
  EmailTemplate,
  Fulfillment,
  MailingAddress,
  Notification,
  Order,
  OrderItem,
  OrderShippingLine,
  Shop,
} from '@shopnex/db/schema'
import { getSettings as getAbandonedSettings, updateSettings as updateAbandonedSettings } from './abandoned-settings'
import { DEFAULTS } from './defaults'
import { send } from './email'
import { EmailError } from './errors'
import { SafeHtml, checkLiquid, render, type LiquidProblem } from './liquid'
import { log } from './log'

export type NotificationInfo = {
  notification: Notification
  title: string
  description: string
  audience: 'customer' | 'staff' | 'layout'
}

export const NOTIFICATION_INFO: NotificationInfo[] = [
  {
    notification: 'order_confirmation',
    title: 'Order confirmation',
    description:
      'Sent to the customer when they place an order (paid through a payments app: once the payment succeeds).',
    audience: 'customer',
  },
  {
    notification: 'shipping_confirmation',
    title: 'Shipping confirmation',
    description: 'Sent to the customer when their order is fulfilled, with tracking details.',
    audience: 'customer',
  },
  {
    notification: 'order_cancelled',
    title: 'Order cancelled',
    description: 'Sent to the customer when you cancel an order they were sent a confirmation for.',
    audience: 'customer',
  },
  {
    notification: 'staff_order',
    title: 'New order',
    description: 'Sent to the shop owners when an order is placed, at the same time as the order confirmation.',
    audience: 'staff',
  },
  {
    notification: 'login_code',
    title: 'Customer sign-in code',
    description: 'Sent when a customer asks to sign in to their account on the storefront. Keep {{ code }} in it.',
    audience: 'customer',
  },
  {
    notification: 'abandoned_cart',
    title: 'Abandoned cart',
    description: 'Sent to a shopper who gave their email at checkout and did not finish. Off until you turn it on.',
    audience: 'customer',
  },
  {
    notification: 'layout',
    title: 'Email layout',
    description: 'The header and footer around every email. The email itself goes where {{ content_for_layout }} is.',
    audience: 'layout',
  },
]

/** What `notify` needs from an order: orderService.getById's result */
export type OrderView = Order & {
  items: OrderItem[]
  shippingLines: OrderShippingLine[]
  fulfillments: Fulfillment[]
  customer: Customer | null
}

export type OrderEvent = 'order.created' | 'order.paid' | 'order.fulfilled' | 'order.cancelled'

// --- Liquid variables (snake_case, Shopify-like names) ---

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

const addressScope = (a: MailingAddress | null) =>
  a && {
    name: [a.firstName, a.lastName].filter(Boolean).join(' '),
    first_name: a.firstName,
    last_name: a.lastName,
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    province: a.province,
    zip: a.zip,
    country: countryName(a.countryCode),
    country_code: a.countryCode,
    phone: a.phone,
  }

export const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')

const adminUrl = (orderId: string) => `${appUrl()}/admin/orders/${orderId}`

export type CheckoutLine = {
  title: string
  variantTitle: string | null
  quantity: number
  unitPriceCents: number
  imageUrl: string | null
}

/** The `checkout` and `unsubscribe_url` variables of the abandoned cart email */
export function checkoutScope(
  { token, firstName, lines }: { token: string; firstName: string | null; lines: CheckoutLine[] },
  unsubscribeUrl: string,
) {
  return {
    unsubscribe_url: unsubscribeUrl,
    checkout: {
      url: `${appUrl()}/checkout/${token}`,
      first_name: firstName,
      item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotal_price: lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0),
      line_items: lines.map((l) => ({
        title: l.title,
        variant_title: l.variantTitle,
        quantity: l.quantity,
        price: l.unitPriceCents,
        line_price: l.unitPriceCents * l.quantity,
        image_url: l.imageUrl,
      })),
    },
  }
}

export function shopScope(shop: Shop) {
  return { name: shop.name, url: shop.storefrontUrl, logo_url: shop.logo, currency: shop.currency }
}

function orderScope(order: OrderView) {
  const name = order.customer?.name ?? addressScope(order.shippingAddress)?.name ?? ''
  const [firstName, ...rest] = name.split(' ')
  const shipping = order.shippingLines[0]
  return {
    id: order.id,
    name: `#${order.orderNumber}`,
    order_number: order.orderNumber,
    email: order.email,
    phone: order.phone,
    created_at: order.createdAt,
    currency: order.currency,
    financial_status: order.financialStatus,
    fulfillment_status: order.fulfillmentStatus,
    cancelled: order.cancelledAt !== null,
    cancel_reason: order.cancelReason,
    subtotal_price: order.subtotalCents,
    shipping_price: order.shippingCents,
    total_discounts: order.discountCents,
    total_tax: order.taxCents,
    total_price: order.totalCents,
    taxes_included: order.taxesIncluded,
    tax_lines: order.taxLines.map((t) => ({ title: t.title, rate_percent: t.ratePercent, price: t.amountCents })),
    discount_codes: order.discountCodes,
    payment_method: order.paymentMethodName,
    payment_instructions: order.paymentInstructions,
    note: order.note,
    admin_url: adminUrl(order.id),
    line_items: order.items.map((i) => ({
      title: i.title,
      variant_title: i.variantTitle,
      sku: i.sku,
      quantity: i.quantity,
      price: i.unitPriceCents,
      line_price: i.unitPriceCents * i.quantity,
      final_line_price: i.unitPriceCents * i.quantity - i.discountCents,
      image_url: i.imageUrl,
    })),
    item_count: order.items.reduce((sum, i) => sum + i.quantity, 0),
    shipping_method: shipping ? { title: shipping.title, price: shipping.priceCents - shipping.discountCents } : null,
    shipping_address: addressScope(order.shippingAddress),
    billing_address: addressScope(order.billingAddress),
    customer: {
      name,
      first_name: firstName || null,
      last_name: rest.join(' ') || null,
      email: order.email,
    },
  }
}

/** How long a sign-in code works (also what the email tells the customer); see @shopnex/auth */
export const LOGIN_CODE_MINUTES = 10

function scopeOf(shop: Shop, order: OrderView) {
  const fulfillment = order.fulfillments.at(-1)
  return {
    // Only login_code uses these; previews show a made-up code
    code: '482913',
    expires_in_minutes: LOGIN_CODE_MINUTES,
    shop: shopScope(shop),
    order: orderScope(order),
    fulfillment: fulfillment && {
      tracking_company: fulfillment.trackingCompany,
      tracking_number: fulfillment.trackingNumber,
      tracking_url: fulfillment.trackingUrl,
    },
  }
}

// --- templates ---

export const sourceOf = (notification: Notification, row: EmailTemplate | undefined) => ({
  subject: row?.subject ?? DEFAULTS[notification].subject,
  body: row?.body ?? DEFAULTS[notification].body,
})

export async function templateRows(conn: Conn, shopId: string, notifications: Notification[]) {
  const rows = await conn
    .select()
    .from(schema.emailTemplates)
    .where(and(eq(schema.emailTemplates.shopId, shopId), inArray(schema.emailTemplates.notification, notifications)))
  return new Map(rows.map((r) => [r.notification, r]))
}

export type Rendered = { subject: string; html: string }

/**
 * Subject and full HTML (the body inside the layout). With `fallback`, a part that fails to render (a merchant's
 * edit) uses the default instead, so a typo never stops an order email. Either way `problem` says what failed.
 */
export async function renderEmail(
  notification: Exclude<Notification, 'layout'>,
  source: { subject: string; body: string },
  layout: string,
  scope: object,
  { fallback }: { fallback: boolean },
): Promise<Rendered & { problem: LiquidProblem | null }> {
  let problem: LiquidProblem | null = null
  const attempt = async (template: string, original: string, extra: object, html: boolean) => {
    const result = await render(template, { ...scope, ...extra }, { html })
    if (result.ok) return result.output
    problem ??= result.problem
    if (!fallback || template === original) return ''
    const again = await render(original, { ...scope, ...extra }, { html })
    return again.ok ? again.output : ''
  }
  const defaults = DEFAULTS[notification]
  const subject = (await attempt(source.subject, defaults.subject, {}, false)).replace(/\s+/g, ' ').trim()
  const body = await attempt(source.body, defaults.body, {}, true)
  const html = await attempt(layout, DEFAULTS.layout.body, { subject, content_for_layout: new SafeHtml(body) }, true)
  return { subject, html, problem }
}

// --- queueing (called by orders and payments, inside their transaction) ---

const recipientsOf = async (conn: Conn, shopId: string, notification: Notification, order: OrderView) => {
  if (notification !== 'staff_order') return order.email ? [order.email] : []
  const owners = await conn
    .select({ email: schema.user.email })
    .from(schema.shopMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.shopMembers.userId))
    .where(and(eq(schema.shopMembers.organizationId, shopId), eq(schema.shopMembers.role, 'owner')))
  return owners.map((o) => o.email)
}

async function wasConfirmed(conn: Conn, orderId: string) {
  const [row] = await conn
    .select({ id: schema.emailDeliveries.id })
    .from(schema.emailDeliveries)
    .where(
      and(eq(schema.emailDeliveries.orderId, orderId), eq(schema.emailDeliveries.notification, 'order_confirmation')),
    )
    .limit(1)
  return Boolean(row)
}

// Which notifications an order event sends. Orders paid through a payments app exist before they're paid, so
// they're confirmed on order.paid; manual methods (bank transfer, cash on delivery) on order.created.
async function notificationsFor(conn: Conn, event: OrderEvent, order: OrderView): Promise<Notification[]> {
  const manual = (order.paymentGateway ?? 'manual') === 'manual'
  switch (event) {
    case 'order.created':
      return manual ? ['order_confirmation', 'staff_order'] : []
    case 'order.paid':
      return manual ? [] : ['order_confirmation', 'staff_order']
    case 'order.fulfilled':
      return ['shipping_confirmation']
    case 'order.cancelled':
      // Only a customer who heard about the order hears it was cancelled (not an abandoned app payment)
      return (await wasConfirmed(conn, order.id)) ? ['order_cancelled'] : []
  }
}

/**
 * Queues the emails `event` sends for this order. Pass the transaction that made the change: they're only sent
 * if it commits, and `load` sees its writes. Shops with email off pay one indexed query. Never throws: a failure
 * here is logged, so an email problem can't fail the order change.
 */
export async function notify(conn: Conn, shopId: string, event: OrderEvent, load: () => Promise<OrderView | null>) {
  const [settings] = await conn
    .select({ active: schema.emailSettings.active })
    .from(schema.emailSettings)
    .where(eq(schema.emailSettings.shopId, shopId))
  if (!settings?.active) return
  try {
    // A savepoint: a failed insert must not abort the caller's transaction
    await conn.transaction(async (tx) => {
      const order = await load()
      if (!order) return
      const notifications = await notificationsFor(tx, event, order)
      if (notifications.length === 0) return
      const [[row], templates] = await Promise.all([
        tx.select().from(schema.shops).where(eq(schema.shops.id, shopId)),
        templateRows(tx, shopId, [...notifications, 'layout']),
      ])
      if (!row) return
      const shop = await withStorefrontUrl(row, tx)
      const scope = scopeOf(shop, order)
      const layout = sourceOf('layout', templates.get('layout')).body
      for (const notification of notifications) {
        if (notification === 'layout' || templates.get(notification)?.enabled === false) continue
        const to = await recipientsOf(tx, shopId, notification, order)
        if (to.length === 0) continue
        const email = await renderEmail(
          notification,
          sourceOf(notification, templates.get(notification)),
          layout,
          scope,
          {
            fallback: true,
          },
        )
        if (email.problem) log.warn({ notification, shopId }, 'template problem: %s', email.problem.message)
        await tx
          .insert(schema.emailDeliveries)
          .values(
            to.map((address) => ({
              shopId,
              notification,
              orderId: order.id,
              to: address,
              subject: email.subject,
              html: email.html,
            })),
          )
          .onConflictDoNothing()
      }
    })
  } catch (error) {
    log.error({ err: error, event, shopId }, 'queueing the notification failed')
  }
}

/**
 * Emails a customer their sign-in code right away. Not queued: the code would sit in the outbox (visible to
 * staff) and a retry hours later is useless. Throws EMAIL_OFF when the shop doesn't send email.
 */
export async function sendLoginCode(shopId: string, to: string, code: string) {
  const [row] = await db.select().from(schema.shops).where(eq(schema.shops.id, shopId))
  if (!row) throw new EmailError('EMAIL_FAILED', 'Shop not found')
  const shop = await withStorefrontUrl(row)
  const templates = await templateRows(db, shopId, ['login_code', 'layout'])
  if (templates.get('login_code')?.enabled === false)
    throw new EmailError('EMAIL_OFF', 'Customer sign-in is turned off')
  const scope = { shop: shopScope(shop), code, expires_in_minutes: LOGIN_CODE_MINUTES }
  const email = await renderEmail(
    'login_code',
    sourceOf('login_code', templates.get('login_code')),
    sourceOf('layout', templates.get('layout')).body,
    scope,
    { fallback: true },
  )
  const { sent } = await send(shopId, { to, subject: email.subject, html: email.html })
  if (!sent) throw new EmailError('EMAIL_OFF', 'This shop does not send email, so customers cannot sign in')
}

// --- Settings → Notifications ---

const isCustomized = (row: EmailTemplate | undefined) => row?.subject != null || row?.body != null

export async function list(shopId: string) {
  const rows = await templateRows(
    db,
    shopId,
    NOTIFICATION_INFO.map((n) => n.notification),
  )
  const abandoned = await getAbandonedSettings(shopId)
  return NOTIFICATION_INFO.map((info) => {
    const row = rows.get(info.notification)
    const enabled = info.notification === 'abandoned_cart' ? abandoned.enabled : (row?.enabled ?? true)
    return { ...info, enabled, customized: isCustomized(row) }
  })
}

const infoOf = (notification: Notification) => NOTIFICATION_INFO.find((n) => n.notification === notification)!

export async function get(shopId: string, notification: Notification) {
  const row = (await templateRows(db, shopId, [notification])).get(notification)
  return {
    ...infoOf(notification),
    ...sourceOf(notification, row),
    defaults: DEFAULTS[notification],
    // Abandoned cart emails are switched in their own settings (off until the shop turns them on)
    enabled: notification === 'abandoned_cart' ? (await getAbandonedSettings(shopId)).enabled : (row?.enabled ?? true),
    customized: isCustomized(row),
  }
}

export type TemplateInput = { subject: string; body: string }

function assertValid(input: TemplateInput) {
  for (const [part, source] of [
    ['Subject', input.subject],
    ['Body', input.body],
  ] as const) {
    const problem = checkLiquid(source)
    if (problem) {
      const where = problem.line && part === 'Body' ? ` (line ${problem.line})` : ''
      throw new EmailError('INVALID_TEMPLATE', `${part}${where}: ${problem.message}`)
    }
  }
}

/** Saves the shop's Liquid; text equal to the default is stored as "default", so later default changes apply */
export async function update(
  shopId: string,
  notification: Notification,
  input: Partial<TemplateInput> & { enabled?: boolean },
) {
  const current = await get(shopId, notification)
  const next = { subject: input.subject ?? current.subject, body: input.body ?? current.body }
  assertValid(next)
  if (notification === 'abandoned_cart' && input.enabled !== undefined)
    await updateAbandonedSettings(shopId, { enabled: input.enabled })
  const values = {
    subject: next.subject === DEFAULTS[notification].subject ? null : next.subject,
    body: next.body === DEFAULTS[notification].body ? null : next.body,
    // The template row's switch isn't used by abandoned cart emails (see get)
    enabled: notification === 'layout' || notification === 'abandoned_cart' ? true : (input.enabled ?? current.enabled),
    updatedAt: new Date(),
  }
  await db
    .insert(schema.emailTemplates)
    .values({ shopId, notification, ...values })
    .onConflictDoUpdate({ target: [schema.emailTemplates.shopId, schema.emailTemplates.notification], set: values })
  return get(shopId, notification)
}

/** Back to the built-in subject and body; on/off stays */
export const revert = (shopId: string, notification: Notification) =>
  update(shopId, notification, { subject: DEFAULTS[notification].subject, body: DEFAULTS[notification].body })

// The shop's latest order (so the preview shows real products), or a made-up one for a new shop
async function previewOrder(shop: Shop): Promise<{ order: OrderView; sample: boolean }> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.shopId, shop.id))
    .orderBy(desc(schema.orders.createdAt))
    .limit(1)
  if (order) {
    const [items, shippingLines, fulfillments, customers] = await Promise.all([
      db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id)),
      db.select().from(schema.orderShippingLines).where(eq(schema.orderShippingLines.orderId, order.id)),
      db.select().from(schema.fulfillments).where(eq(schema.fulfillments.orderId, order.id)),
      order.customerId ? db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)) : [],
    ])
    return { order: { ...order, items, shippingLines, fulfillments, customer: customers[0] ?? null }, sample: false }
  }
  return { order: sampleOrder(shop), sample: true }
}

function sampleOrder(shop: Shop): OrderView {
  const now = new Date()
  const address: MailingAddress = {
    firstName: 'Jamie',
    lastName: 'Rivera',
    company: null,
    address1: '123 Market Street',
    address2: 'Apt 4',
    city: 'San Francisco',
    province: 'CA',
    countryCode: 'US',
    zip: '94103',
    phone: null,
  }
  const item = (title: string, variantTitle: string | null, unitPriceCents: number, quantity: number): OrderItem => ({
    id: crypto.randomUUID(),
    orderId: 'sample',
    productId: null,
    variantId: null,
    title,
    variantTitle,
    sku: null,
    vendor: null,
    imageUrl: null,
    unitPriceCents,
    quantity,
    discountCents: 0,
  })
  return {
    id: 'sample',
    shopId: shop.id,
    channelId: 'sample',
    orderNumber: 1001,
    customerId: null,
    email: 'jamie@example.com',
    phone: null,
    currency: shop.currency,
    financialStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    cancelledAt: null,
    cancelReason: null,
    subtotalCents: 6800,
    shippingCents: 500,
    discountCents: 0,
    taxCents: 0,
    totalCents: 7300,
    taxesIncluded: false,
    taxLines: [],
    discountCodes: [],
    shippingAddress: address,
    billingAddress: address,
    paymentGateway: 'manual',
    paymentMethodName: 'Bank transfer',
    paymentInstructions: null,
    note: null,
    customFields: {},
    createdAt: now,
    updatedAt: now,
    items: [item('Classic T-shirt', 'M / Black', 2400, 2), item('Canvas tote bag', null, 2000, 1)],
    shippingLines: [
      { id: 'sample', orderId: 'sample', title: 'Standard', code: null, priceCents: 500, discountCents: 0 },
    ],
    fulfillments: [
      {
        id: 'sample',
        orderId: 'sample',
        status: 'success',
        trackingCompany: 'UPS',
        trackingNumber: '1Z999AA10123456784',
        trackingUrl: null,
        createdAt: now,
      },
    ],
    customer: null,
  }
}

async function shopOf(shopId: string) {
  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, shopId))
  if (!shop) throw new EmailError('EMAIL_FAILED', 'Shop not found')
  return withStorefrontUrl(shop)
}

/**
 * Renders unsaved Liquid with the shop's latest order (or a sample one), the way it would be sent. Errors are
 * returned, not hidden: the editor shows them. The layout previews around the order confirmation.
 */
export async function preview(shopId: string, notification: Notification, input: TemplateInput) {
  const shop = await shopOf(shopId)
  const { order, sample } = await previewOrder(shop)
  const templates = await templateRows(db, shopId, ['order_confirmation', 'layout'])
  const [target, source, layout] =
    notification === 'layout'
      ? ([
          'order_confirmation',
          sourceOf('order_confirmation', templates.get('order_confirmation')),
          input.body,
        ] as const)
      : ([notification, input, sourceOf('layout', templates.get('layout')).body] as const)
  // The abandoned cart email previews with the same products as the order, as if they were still in a cart
  const checkout = checkoutScope(
    {
      token: 'preview',
      firstName: order.customer?.name?.split(' ')[0] ?? 'Jamie',
      lines: order.items.map((i) => ({
        title: i.title,
        variantTitle: i.variantTitle,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        imageUrl: i.imageUrl,
      })),
    },
    `${appUrl()}/unsubscribe/preview`,
  )
  const email = await renderEmail(target, source, layout, { ...scopeOf(shop, order), ...checkout }, { fallback: false })
  return { ...email, sample }
}

/** Sends the preview to `to` (the staff member asking) through the shop's email settings */
export async function sendTest(shopId: string, notification: Notification, input: TemplateInput, to: string) {
  const email = await preview(shopId, notification, input)
  if (email.problem) throw new EmailError('INVALID_TEMPLATE', email.problem.message)
  const { sent } = await send(shopId, { to, subject: `[Test] ${email.subject}`, html: email.html })
  if (!sent) throw new EmailError('EMAIL_OFF', 'Email is off. Set up sending in Settings → Email first.')
  return { to }
}

/** The shop's recent notification emails, newest first (without their HTML) */
export async function deliveries(shopId: string, limit = 25) {
  return db
    .select({
      id: schema.emailDeliveries.id,
      notification: schema.emailDeliveries.notification,
      orderId: schema.emailDeliveries.orderId,
      to: schema.emailDeliveries.to,
      subject: schema.emailDeliveries.subject,
      status: schema.emailDeliveries.status,
      attempts: schema.emailDeliveries.attempts,
      lastError: schema.emailDeliveries.lastError,
      createdAt: schema.emailDeliveries.createdAt,
    })
    .from(schema.emailDeliveries)
    .where(eq(schema.emailDeliveries.shopId, shopId))
    .orderBy(desc(schema.emailDeliveries.createdAt))
    .limit(limit)
}
