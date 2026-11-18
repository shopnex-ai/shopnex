// What the email tests share: the embedded database, a fake SMTP server on localhost that records what ShopNex sends and answers the
// way a test says, and a few rows. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { shops, user as userTable } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
delete process.env.TENANCY_MODE

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { shopMembers } = await import('@shopnex/tenancy/schema')

export { db, schema, prepareDatabase, eq }
export const SHOP = 'default'
export const OTHER_SHOP = 'email-other-shop'

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
let orderNumber = 500_000
const made = {
  orders: [] as string[],
  carts: [] as string[],
  users: [] as string[],
  customers: [] as string[],
  products: [] as string[],
}

// ── the fake SMTP server (no login, no TLS: enough for nodemailer to verify and send)
export interface Received {
  from: string
  to: string[]
  subject: string
  raw: string
}
export const behavior = { rejectRecipients: false, dropConnections: false }
export const received: Received[] = []
let server: Server
export let smtpPort = 0

function handle(socket: Socket) {
  if (behavior.dropConnections) return socket.destroy()
  let from = ''
  let to: string[] = []
  let data: string | null = null
  let buffer = ''
  const reply = (line: string) => socket.write(`${line}\r\n`)
  reply('220 localhost ESMTP fake')
  socket.on('data', (chunk) => {
    buffer += chunk.toString('latin1')
    for (;;) {
      if (data !== null) {
        const end = buffer.indexOf('\r\n.\r\n')
        if (end === -1) return
        data += buffer.slice(0, end)
        buffer = buffer.slice(end + 5)
        const subject = /^Subject: (.*)$/im.exec(data)?.[1] ?? ''
        received.push({ from, to, subject, raw: data })
        data = null
        reply('250 queued')
        continue
      }
      const eol = buffer.indexOf('\r\n')
      if (eol === -1) return
      const line = buffer.slice(0, eol)
      buffer = buffer.slice(eol + 2)
      const command = line.slice(0, 4).toUpperCase()
      if (command === 'EHLO' || command === 'HELO') reply('250-localhost\r\n250 8BITMIME')
      else if (command === 'MAIL') {
        from = /<([^>]*)>/.exec(line)?.[1] ?? ''
        to = []
        reply('250 ok')
      } else if (command === 'RCPT') {
        if (behavior.rejectRecipients) reply('550 mailbox unavailable')
        else {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          reply('250 ok')
        }
      } else if (command === 'DATA') {
        data = ''
        reply('354 go ahead')
      } else if (command === 'QUIT') {
        reply('221 bye')
        socket.end()
      } else reply('250 ok')
    }
  })
  socket.on('error', () => undefined)
}

export async function startSmtp() {
  server = createServer(handle)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  smtpPort = (server.address() as AddressInfo).port
}
export const stopSmtp = () => new Promise((resolve) => server.close(resolve))
export function resetSmtp() {
  behavior.rejectRecipients = false
  behavior.dropConnections = false
  received.length = 0
}

// ── rows
export const smtpConfig = (patch: Record<string, unknown> = {}) => ({
  preset: 'other' as const,
  host: '127.0.0.1',
  port: smtpPort,
  username: '',
  fromName: 'Test Shop',
  fromEmail: 'shop@example.test',
  ...patch,
})

/** Email settings for the shop pointing at the fake server (or somewhere else) */
export async function turnOn(patch: Partial<typeof schema.emailSettings.$inferInsert> = {}, shopId = SHOP) {
  const values = { shopId, active: true, config: smtpConfig(), ...patch }
  await db
    .insert(schema.emailSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.emailSettings.shopId, set: values })
}

export async function otherShop() {
  await db.insert(shops).values({ id: OTHER_SHOP, name: 'Other', slug: OTHER_SHOP }).onConflictDoNothing()
}

export async function owner(shopId = SHOP) {
  const id = `u-${unique()}`
  await db.insert(userTable).values({ id, name: 'Owner', email: `${id}@shop.test`, emailVerified: true })
  await db.insert(shopMembers).values({ id: `m-${unique()}`, organizationId: shopId, userId: id, role: 'owner' })
  made.users.push(id)
  return `${id}@shop.test`
}

export async function order(patch: Partial<typeof schema.orders.$inferInsert> = {}) {
  const shopId = patch.shopId ?? SHOP
  let [channel] = await db.select().from(schema.channels).where(eq(schema.channels.shopId, shopId))
  channel ??= (
    await db.insert(schema.channels).values({ shopId, handle: 'online-store', name: 'Online Store' }).returning()
  )[0]!
  const [row] = await db
    .insert(schema.orders)
    .values({
      shopId,
      orderNumber: ++orderNumber,
      channelId: channel.id,
      email: 'buyer@example.test',
      subtotalCents: 1000,
      totalCents: 1000,
      ...patch,
    })
    .returning()
  made.orders.push(row!.id)
  return row!
}

export async function customer(patch: Partial<typeof schema.customers.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.customers)
    .values({ shopId: SHOP, email: `c-${unique()}@example.test`, ...patch })
    .returning()
  made.customers.push(row!.id)
  return row!
}

/** A product with one variant, for the lines of a cart */
export async function variant(patch: Partial<typeof schema.productVariants.$inferInsert> = {}) {
  const [product] = await db
    .insert(schema.products)
    .values({ shopId: SHOP, slug: `p-${unique()}`, title: 'Linen shirt', priceCents: 2500 })
    .returning()
  made.products.push(product!.id)
  const [row] = await db
    .insert(schema.productVariants)
    .values({
      shopId: SHOP,
      productId: product!.id,
      optionsKey: '',
      title: 'Default Title',
      priceCents: 2500,
      ...patch,
    })
    .returning()
  return { product: product!, variant: row! }
}

/** An active cart with an email and one line, last touched `idleMinutes` ago */
export async function cart(
  opts: { email?: string | null; idleMinutes?: number; lines?: number; status?: 'active' | 'completed' } = {},
) {
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.shopId, SHOP))
  const idle = new Date(Date.now() - (opts.idleMinutes ?? 0) * 60_000)
  const [row] = await db
    .insert(schema.carts)
    .values({
      shopId: SHOP,
      channelId: channel!.id,
      token: `t-${unique()}`,
      email: opts.email === undefined ? 'shopper@example.test' : opts.email,
      status: opts.status ?? 'active',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: idle,
      updatedAt: idle,
    })
    .returning()
  made.carts.push(row!.id)
  for (let i = 0; i < (opts.lines ?? 1); i++) {
    const { variant: v } = await variant()
    await db.insert(schema.cartLines).values({ cartId: row!.id, variantId: v.id, quantity: 2 })
  }
  return row!
}

export async function cleanup() {
  const shopIds = [SHOP, OTHER_SHOP]
  await db.delete(schema.emailDeliveries).where(inArray(schema.emailDeliveries.shopId, shopIds))
  await db.delete(schema.emailSettings).where(inArray(schema.emailSettings.shopId, shopIds))
  await db.delete(schema.emailTemplates).where(inArray(schema.emailTemplates.shopId, shopIds))
  await db.delete(schema.abandonedCartSettings).where(inArray(schema.abandonedCartSettings.shopId, shopIds))
  await db.delete(schema.emailSuppressions).where(inArray(schema.emailSuppressions.shopId, shopIds))
  if (made.carts.length) await db.delete(schema.carts).where(inArray(schema.carts.id, made.carts))
  if (made.orders.length) await db.delete(schema.orders).where(inArray(schema.orders.id, made.orders))
  if (made.customers.length) await db.delete(schema.customers).where(inArray(schema.customers.id, made.customers))
  if (made.products.length) await db.delete(schema.products).where(inArray(schema.products.id, made.products))
  if (made.users.length) {
    await db.delete(shopMembers).where(inArray(shopMembers.userId, made.users))
    await db.delete(userTable).where(inArray(userTable.id, made.users))
  }
  for (const list of Object.values(made)) list.length = 0
}
