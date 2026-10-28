// The optional template against the running Shopnex API and PostgreSQL, including
// real app installation, session exchange, shop scoping and uninstall revocation.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { createShopnexApp } from '@shopnex/app'
import { appService, instanceUrl } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import {
  createOrderInquiryRoutes as createOrderInquiryApp,
  orderReferences,
} from '../../templates/order-inquiry/src/routes'
import { Fixtures, SHOP, closeDb, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
let registered: Awaited<ReturnType<typeof appService.registerApp>>
let app: ReturnType<typeof createOrderInquiryApp>
let installationId: string
let otherInstallationId: string
let otherShopId: string
let order: { id: string; orderNumber: number }
let instance: string

async function token(shopId = SHOP, id = installationId) {
  return appService.createSessionToken({ shopId, installationId: id, userId: 'e2e-inquiry-staff' })
}

async function post(path: string, body: object, session?: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session ?? (await token())}` },
    body: JSON.stringify(body),
  })
}

before(async () => {
  await requireApp()
  await fx.init()
  instance = await instanceUrl()
  registered = await appService.registerApp(
    {
      name: `E2E order inquiry ${Date.now()}`,
      appUrl: 'http://127.0.0.1:4501',
      redirectUrls: [],
      scopes: ['read_orders'],
    },
    null,
  )
  const installation = await appService.installManaged({
    appId: registered.app.id,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['read_orders'],
  })
  installationId = installation.id
  const other = await fx.shop()
  otherShopId = other.id
  otherInstallationId = (
    await appService.installManaged({
      appId: registered.app.id,
      shopId: other.id,
      userId: null as unknown as string,
      scopes: ['read_orders'],
    })
  ).id
  const [variant] = await sellableVariants(1)
  assert.ok(variant)
  order = await orderService.create(SHOP, { email: fx.email, items: [{ variantId: variant.id, quantity: 1 }] })
  fx.order(order.id)
  app = createOrderInquiryApp(createShopnexApp({ clientId: registered.app.clientId, appKey: registered.privateKey }))
})

after(async () => {
  try {
    if (registered) await db.delete(schema.apps).where(eq(schema.apps.id, registered.app.id))
    await fx.cleanup()
  } finally {
    await closeDb()
  }
})

test('issue and look up an existing order through the installed read-only app', async () => {
  const created = await post('/api/reference', { orderLink: `${instance}/admin/orders/${order.id}` })
  assert.equal(created.status, 200, await created.clone().text())
  const body = await created.json()
  assert.equal(body.orderNumber, order.orderNumber)
  const found = await post('/api/lookup', { reference: body.reference })
  assert.equal(found.status, 200, await found.clone().text())
  assert.deepEqual(await found.json(), {
    orderNumber: order.orderNumber,
    redirect: `${instance}/admin/orders/${order.id}`,
  })
})

test('a typo is invalid but a well-formed unknown order is not found', async () => {
  const code = orderReferences.encode(order.id)
  const typo = code.slice(0, -1) + (code.endsWith('q') ? 'p' : 'q')
  assert.equal((await post('/api/lookup', { reference: typo })).status, 400)
  assert.equal((await post('/api/lookup', { reference: orderReferences.encode(crypto.randomUUID()) })).status, 404)
})

test('the same valid code cannot read an order through another shop installation', async () => {
  const otherSession = await token(otherShopId, otherInstallationId)
  assert.equal(
    (await post('/api/lookup', { reference: orderReferences.encode(order.id), shopId: SHOP }, otherSession)).status,
    404,
  )
  assert.equal(
    (await post('/api/reference', { orderLink: `${instance}/admin/orders/${order.id}` }, otherSession)).status,
    404,
  )
})

test('uninstall revokes an already cached SDK access token', async () => {
  const session = await token()
  assert.ok(await appService.uninstall(SHOP, installationId))
  const result = await post('/api/lookup', { reference: orderReferences.encode(order.id) }, session)
  assert.equal(result.status, 401, await result.clone().text())
})
