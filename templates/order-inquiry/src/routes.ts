import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { ShopnexError, type AdminClient, type ShopnexApp } from '@shopnex/app'
import { createReferenceCodec } from 'refmint/codec'

// Encodes the existing UUID: no new ID, webhook, alias table or write scope.
export const orderReferences = createReferenceCodec({ prefix: 'order', kind: 'uuid', version: 1 })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Order = { id: string; orderNumber: number }

async function readOrder(admin: AdminClient, id: string): Promise<Order> {
  const order = await admin.get<Order>(`/orders/${id}`)
  if (order.id !== id || !Number.isSafeInteger(order.orderNumber)) {
    throw new Error('Unexpected order response')
  }
  // Return only what the app needs; an order response also contains customer data.
  return { id: order.id, orderNumber: order.orderNumber }
}

function field(body: unknown, name: string): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'Enter a value in the form.' })
  }
  const value = (body as Record<string, unknown>)[name]
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    throw new HTTPException(400, { message: 'Enter a value of at most 500 characters.' })
  }
  return value
}

function orderIdFromLink(link: string, instance: string) {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new HTTPException(400, { message: 'Paste an order link from this Shopnex admin.' })
  }
  const id = url.pathname.replace(/^\/admin\/orders\//, '')
  if (
    url.origin !== instance ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/admin/orders/') ||
    !UUID.test(id)
  ) {
    throw new HTTPException(400, { message: 'Paste an order link from this Shopnex admin.' })
  }
  return id
}

export function createOrderInquiryRoutes(shopnex: Pick<ShopnexApp, 'routes' | 'authenticate'>) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    await next()
  })
  app.route('/', shopnex.routes)
  app.use('/api/*', bodyLimit({ maxSize: 2048 }))

  app.post('/api/reference', async (c) => {
    const { instance, admin } = await shopnex.authenticate(c)
    const body = await c.req.json<unknown>().catch(() => null)
    const id = orderIdFromLink(field(body, 'orderLink'), instance)
    const order = await readOrder(admin, id)
    return c.json({
      reference: orderReferences.format(orderReferences.encode(order.id)),
      orderNumber: order.orderNumber,
      message: `Reference ready for order #${order.orderNumber}`,
    })
  })

  app.post('/api/lookup', async (c) => {
    // The authenticated SDK context chooses the instance/shop. Input never chooses a tenant.
    const { instance, admin } = await shopnex.authenticate(c)
    const body = await c.req.json<unknown>().catch(() => null)
    const result = orderReferences.diagnose(field(body, 'reference'))
    if (!result.ok) return c.json({ error: `Check the order reference (${result.error}).` }, 400)
    const order = await readOrder(admin, result.value)
    return c.json({
      orderNumber: order.orderNumber,
      redirect: `${instance}/admin/orders/${order.id}`,
    })
  })

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    if (error instanceof ShopnexError) {
      if (error.status === 404) return c.json({ error: 'Order not found in this shop.' }, 404)
      if (error.status === 401 || error.status === 403) {
        return c.json({ error: 'Open the app from your admin with order read access.' }, error.status)
      }
    }
    return c.json({ error: 'The order could not be read. Try again later.' }, 502)
  })
  return app
}
