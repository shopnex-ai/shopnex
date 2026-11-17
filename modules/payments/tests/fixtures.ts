// What the payments tests share: the embedded database, and a fake payments app on localhost that records what ShopNex sends it
// and answers the way a test says. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.APP_URL = 'http://shop.test'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { eq } = await import('drizzle-orm')

export { db, schema, prepareDatabase }
export const SHOP = 'default'

// ── the fake payments app
export interface Received {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}
export const behavior = { pay: 'ok' as 'ok' | 'fail' | 'no-redirect', refund: 'ok' as 'ok' | 'fail' }
export const received: Received[] = []
let server: Server
export let appUrl = ''

export async function startFakeApp() {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>
      received.push({ path: req.url ?? '', headers: req.headers, body })
      const answer = (status: number, json: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
      if (req.url === '/pay') {
        if (behavior.pay === 'fail') return answer(500, { error: 'provider is down' })
        if (behavior.pay === 'no-redirect') return answer(200, {})
        return answer(200, { redirectUrl: `https://pay.example/checkout/${String(body.id)}` })
      }
      if (req.url === '/refund')
        return behavior.refund === 'fail' ? answer(500, { error: 'cannot refund' }) : answer(200, {})
      return answer(404, {})
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
export const stopFakeApp = () => new Promise((resolve) => server.close(resolve))

export function resetFakeApp() {
  behavior.pay = 'ok'
  behavior.refund = 'ok'
  received.length = 0
}

// ── rows
let counter = 0
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`

/** An app that can take payments, with its method in the shop. `installed: false` leaves it uninstalled. */
export async function paymentsApp(
  opts: { installed?: boolean; ready?: boolean; active?: boolean; name?: string } = {},
) {
  const [app] = await db
    .insert(schema.apps)
    .values({
      name: opts.name ?? 'Fake pay',
      appUrl: appUrl,
      redirectUrls: [],
      scopes: ['write_payment_sessions'],
      clientId: `fake-${unique()}`,
    })
    .returning()
  const [installation] = await db
    .insert(schema.appInstallations)
    .values({
      appId: app!.id,
      shopId: SHOP,
      scopes: ['write_payment_sessions'],
      ...(opts.installed === false ? { uninstalledAt: new Date() } : {}),
    })
    .returning()
  const [method] = await db
    .insert(schema.paymentMethods)
    .values({
      shopId: SHOP,
      provider: 'app',
      name: opts.name ?? 'Fake pay',
      appId: app!.id,
      gateway: 'fakepay',
      ready: opts.ready ?? true,
      active: opts.active ?? true,
      paymentSessionUrl: `${appUrl}/pay`,
      refundSessionUrl: `${appUrl}/refund`,
    })
    .returning()
  return { app: app!, installation: installation!, method: method! }
}

let orderNumber = 800_000
/** An unpaid order of 25.00 USD, unless said otherwise */
export async function order(patch: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [channel] = await db.select({ id: schema.channels.id }).from(schema.channels).limit(1)
  const [row] = await db
    .insert(schema.orders)
    .values({
      shopId: SHOP,
      orderNumber: ++orderNumber,
      channelId: channel!.id,
      email: `buyer-${orderNumber}@example.com`,
      subtotalCents: 2500,
      totalCents: 2500,
      ...patch,
    })
    .returning()
  return row!
}

export async function sessionOf(id: string) {
  const [row] = await db.select().from(schema.paymentSessions).where(eq(schema.paymentSessions.id, id))
  return row
}

export async function cleanup() {
  await db.delete(schema.orders).where(eq(schema.orders.shopId, SHOP))
  await db.delete(schema.paymentMethods).where(eq(schema.paymentMethods.shopId, SHOP))
  await db.delete(schema.appInstallations).where(eq(schema.appInstallations.shopId, SHOP))
  await db.delete(schema.apps).where(eq(schema.apps.source, 'custom'))
}
