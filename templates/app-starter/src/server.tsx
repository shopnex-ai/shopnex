// Shopnex app starter: an embedded app with no database and no OAuth code (@shopnex/app does both).
//
//   GET  /             The app's page inside the Shopnex admin
//   POST /api/notes    Saves a note in the shop's app data (called by the page's form)
//   POST /webhooks     order.created deliveries, checked against the shop's published keys
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createShopnexApp, type ShopContext } from '@shopnex/app'
import { Button, Card, Form, Inline, Page, Stat, Text, TextField } from '@shopnex/app/ui'

const APP_URL = (process.env.APP_URL ?? 'http://localhost:4500').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4500)
const shopnex = createShopnexApp()

const app = new Hono()
app.route('/', shopnex.routes)

async function stats(shop: ShopContext) {
  const [products, orders] = await Promise.all([
    shop.admin.get<{ total: number }>('/products?limit=1'),
    shop.admin.get<{ total: number }>('/orders?limit=1'),
  ])
  return { products: products.total, orders: orders.total }
}

app.get('/', async (c) => {
  const { shop, ...ctx } = await shopnex.authenticate(c)
  const [s, note] = await Promise.all([stats(ctx), ctx.data.get<string>('note'), subscribe(ctx)])
  return c.html(
    <Page
      title="App starter"
      subtitle={`Connected to ${shop.name}`}
      actions={
        <Button action="/api/ping" reload variant="secondary">
          Refresh
        </Button>
      }
    >
      <Card title="Your shop">
        <Inline gap={8}>
          <Stat label="Products" value={s.products} />
          <Stat label="Orders" value={s.orders} />
        </Inline>
        <Text tone="subdued">New orders are logged by this app's server (order.created webhook).</Text>
      </Card>
      <Card title="Note" description="Kept in the shop's Shopnex (app data): this app stores nothing itself.">
        <Form action="/api/notes" success="Saved">
          <TextField label="Note" name="note" value={note} multiline />
          <div>
            <Button>Save</Button>
          </div>
        </Form>
      </Card>
    </Page>,
  )
})

app.post('/api/ping', async (c) => {
  await shopnex.authenticate(c)
  return c.json({ message: 'Refreshed' })
})

app.post('/api/notes', async (c) => {
  const { data } = await shopnex.authenticate(c)
  const { note } = await c.req.json<{ note?: string }>()
  await data.set('note', note ?? '')
  return c.json({ ok: true })
})

// Subscribe once per shop (the subscription belongs to the app's installation)
async function subscribe(shop: ShopContext) {
  const url = `${APP_URL}/webhooks`
  const hooks = await shop.admin.get<{ url: string }[]>('/webhooks')
  if (!hooks.some((h) => h.url === url)) await shop.admin.post('/webhooks', { url, topics: ['order.created'] })
}

app.post('/webhooks', async (c) => {
  const { event, shop } = await shopnex.verifyWebhook<{ orderNumber?: number }>(c)
  console.log(`[webhook] ${shop.instance} shop ${shop.shopId}: ${event.type}`, event.data.orderNumber ?? '')
  return c.body(null, 204)
})

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error(error)
  return c.json({ error: error.message }, 500)
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`App starter on ${APP_URL}`))
