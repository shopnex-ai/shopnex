// AI apps end to end, against a fake app served by this test: the app registers its capabilities (app token) →
// staff (here: an API token) run one → Shopnex sends the product to the app, signed → checks and sanitizes the
// answer → keeps the generation. Uses its own app and product (deleted at the end).
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { appService } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { verifyAiRequest, type AiRunRequest } from '@shopnex/marketplace-sdk/ai'
import { createJwksResolver } from '@shopnex/marketplace-sdk/keys'
import { Fixtures, SHOP, appToken, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()

let server: Server
let appUrl: string
let appId: string
let installationId: string
let auth: Record<string, string>
let staff: Record<string, string>
let productId: string
// Requests are checked against the instance's published keys, like a real app does
const keys = createJwksResolver({ allowHttp: true })

// What the fake app received, and what it answers next
const received: AiRunRequest[] = []
let answer: (request: AiRunRequest) => unknown = () => ({})

before(async () => {
  await requireApp()
  await fx.init()

  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = await verifyAiRequest(new Headers(req.headers as Record<string, string>), body, { keys })
    if (!request) return res.writeHead(401).end('bad signature')
    received.push(request)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(answer(request)))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const { app, privateKey } = await appService.registerApp(
    { name: `E2E AI ${Date.now()}`, appUrl: `${appUrl}/app`, redirectUrls: [], scopes: ['write_ai_capabilities'] },
    null,
  )
  appId = app.id
  const installed = await appService.installManaged({
    appId,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['write_ai_capabilities'],
  })
  installationId = installed.id
  auth = { authorization: `Bearer ${await appToken(app.clientId, privateKey, { shop_id: SHOP })}` }
  staff = await fx.token(['write_products'])

  const product = ok(
    await call(
      'POST',
      '/admin/products',
      {
        title: `E2E linen shirt ${Date.now()}`,
        descriptionHtml: '<p>Breathable <strong>linen</strong>.</p>',
        vendor: 'E2E',
        productType: 'Shirt',
        tags: ['summer'],
        priceCents: 4500,
      },
      staff,
    ),
  )
  productId = product.id
})

after(async () => {
  if (productId) await db.delete(schema.products).where(eq(schema.products.id, productId))
  await fx.cleanup()
  // The app owns its providers, installation and token; its generations stay (app id set null): remove ours
  if (appId) {
    await db.delete(schema.aiGenerations).where(eq(schema.aiGenerations.appId, appId))
    await db.delete(schema.apps).where(eq(schema.apps.id, appId))
  }
  server?.close()
  await closeDb()
})

const configure = (capabilities: object, headers = auth) =>
  call('POST', '/admin/ai-app/configure', { capabilities }, headers)
const capabilities = async () =>
  (
    ok(await call('GET', '/admin/ai/capabilities', undefined, staff)) as {
      capability: string
      apps: { id: string }[]
    }[]
  )
    .filter((c) => c.apps.some((a) => a.id === appId))
    .map((c) => c.capability)
const run = (body: object) => call('POST', '/admin/ai/run', { productId, appId, ...body }, staff)
const generation = async (id: string) => {
  const [row] = await db.select().from(schema.aiGenerations).where(eq(schema.aiGenerations.id, id))
  return row!
}

describe('AI app: configure', () => {
  test('rejects URLs off the app origin, tokens without an app and unknown capabilities', async () => {
    ok(await configure({ 'product.description': 'https://evil.example.com/run' }), 400)
    ok(await configure({ 'product.description': `${appUrl}/run` }, await fx.token(['write_ai_capabilities'])), 403)
    ok(await configure({ 'order.refund': `${appUrl}/run` }), 400)
  })

  test('registers capabilities; staff see them', async () => {
    const r = ok(await configure({ 'product.description': `${appUrl}/description`, 'product.seo': `${appUrl}/seo` }))
    assert.deepEqual(Object.keys(r.capabilities).sort(), ['product.description', 'product.seo'])
    assert.deepEqual((await capabilities()).sort(), ['product.description', 'product.seo'])
  })
})

describe('AI app: run', () => {
  test('sends the product, signed; returns a sanitized suggestion and keeps the generation', async () => {
    answer = () => ({
      output: { descriptionHtml: '<p>Cool <em>linen</em> shirt.</p><script>alert(1)</script>' },
      usage: { model: 'e2e-model', inputTokens: 120, outputTokens: 40 },
    })
    const r = ok(
      await run({ capability: 'product.description', input: { tone: 'warm', instructions: 'Mention summer' } }),
    )

    const request = received.at(-1)!
    assert.equal(request.capability, 'product.description')
    assert.equal(request.id, r.id)
    assert.equal(request.shopId, SHOP)
    assert.deepEqual(request.input, { tone: 'warm', instructions: 'Mention summer' })
    assert.equal(request.subject.product.id, productId)
    assert.equal(request.subject.product.description, 'Breathable linen.')
    assert.deepEqual(request.subject.product.tags, ['summer'])
    assert.equal(request.subject.product.variants[0]?.price.cents, 4500)

    assert.equal(r.app.id, appId)
    assert.ok(r.output.descriptionHtml.includes('<em>linen</em>'))
    assert.ok(!r.output.descriptionHtml.includes('<script'), 'the description is sanitized')
    assert.equal(r.usage.model, 'e2e-model')

    const row = await generation(r.id)
    assert.equal(row.status, 'succeeded')
    assert.equal(row.subjectId, productId)
    assert.equal(row.userId, null, 'an API token has no user')

    // Nothing is saved on the product
    const product = ok(await call('GET', `/admin/products/${productId}`, undefined, staff))
    assert.equal(product.descriptionHtml, '<p>Breathable <strong>linen</strong>.</p>')
  })

  test('product.seo is typed by its own schema', async () => {
    answer = () => ({ output: { title: 'Linen shirt for summer', description: 'Light and breathable.' } })
    const r = ok(await run({ capability: 'product.seo' }))
    assert.deepEqual(r.output, { title: 'Linen shirt for summer', description: 'Light and breathable.' })
    ok(await run({ capability: 'product.seo', input: { tone: 'warm' } }), 200) // unknown input keys are dropped
    ok(await run({ capability: 'product.description', input: { tone: 'grumpy' } }), 400)
  })

  test("an answer that doesn't match the capability fails (502) and is kept as failed", async () => {
    answer = () => ({ output: { text: 'wrong shape' } })
    const r = await run({ capability: 'product.seo' })
    ok(r, 502)
    const request = received.at(-1)!
    const row = await generation(request.id)
    assert.equal(row.status, 'failed')
    assert.match(row.errorMessage ?? '', /doesn't match product\.seo/)
  })

  test('needs read_products and an existing product', async () => {
    ok(
      await call('POST', '/admin/ai/run', { capability: 'product.seo', productId }, await fx.token(['read_orders'])),
      403,
    )
    ok(await run({ capability: 'product.seo', productId: '00000000-0000-4000-8000-000000000000' }), 404)
  })

  test('feedback is recorded on succeeded generations', async () => {
    answer = () => ({ output: { title: 'T', description: 'D' } })
    const r = ok(await run({ capability: 'product.seo' }))
    ok(await call('POST', `/admin/ai/generations/${r.id}/feedback`, { feedback: 'accepted' }, staff))
    assert.equal((await generation(r.id)).feedback, 'accepted')
    const missing = '00000000-0000-4000-8000-000000000000'
    ok(await call('POST', `/admin/ai/generations/${missing}/feedback`, { feedback: 'rejected' }, staff), 404)
  })
})

describe('AI app: removing capabilities', () => {
  test('configure replaces the set', async () => {
    ok(await configure({ 'product.seo': `${appUrl}/seo` }))
    assert.deepEqual(await capabilities(), ['product.seo'])
    ok(await run({ capability: 'product.description' }), 400)
  })

  test('uninstalling the app removes them', async () => {
    await appService.uninstall(SHOP, installationId)
    assert.deepEqual(await capabilities(), [])
    const [left] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.appId, appId))
    assert.equal(left, undefined)
  })
})
