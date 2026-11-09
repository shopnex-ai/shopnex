import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createClient } from '../src/client'
import { createServer, toolsFor } from '../src/server'
import { TOOLS } from '../src/tools'

type Call = { method: string; url: string; body: unknown; auth: string | null }

// A fake ShopNex: answers by "METHOD /path", records what was asked
function fake(routes: Record<string, unknown>) {
  const calls: Call[] = []
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/v1/admin', '')}`
    calls.push({
      method: init?.method ?? 'GET',
      url: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get('authorization'),
    })
    if (!(key in routes)) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 })
    const out = routes[key]
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 })
  }) as typeof fetch
  return { calls, client: createClient({ url: 'http://shop.test/', token: 'sk_test', fetch: doFetch }) }
}

async function connect(routes: Record<string, unknown>, options: { readOnly?: boolean } = {}) {
  const f = fake(routes)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(f.client, options).connect(a)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args })
    const content = res.content as { text: string }[]
    return { isError: Boolean(res.isError), data: res.isError ? content[0]!.text : JSON.parse(content[0]!.text) }
  }
  return { ...f, client, call }
}

const ID = '11111111-1111-4111-8111-111111111111'
const product = (over = {}) => ({
  id: ID,
  title: 'Mug',
  status: 'draft',
  slug: 'mug',
  vendor: '',
  productType: '',
  tags: [],
  images: [],
  collectionSlugs: [],
  variants: [{ id: ID, title: 'Default', sku: 'MUG', priceCents: 1500, inventoryQuantity: 3 }],
  ...over,
})
const order = (over = {}) => ({
  id: ID,
  orderNumber: 1001,
  email: 'a@example.com',
  customerName: 'Ada',
  financialStatus: 'pending',
  fulfillmentStatus: 'unfulfilled',
  cancelledAt: null,
  currency: 'USD',
  totalCents: 2500,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

describe('tool surface', () => {
  it('is curated, not one tool per endpoint', () => {
    assert.ok(TOOLS.length >= 15 && TOOLS.length <= 30, `${TOOLS.length} tools`)
  })

  it('has unique snake_case names and descriptions the model can use', () => {
    const names = TOOLS.map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
    for (const t of TOOLS) {
      assert.match(t.name, /^[a-z][a-z0-9_]*$/)
      assert.ok(t.description.length > 30, t.name)
    }
  })

  it('every gated tool is a write and takes confirm', () => {
    for (const t of TOOLS.filter((t) => t.gated)) {
      assert.ok(t.write, t.name)
      assert.ok('confirm' in t.input, t.name)
    }
  })

  it('read-only mode offers no write tool', () => {
    const tools = toolsFor({ readOnly: true })
    assert.ok(tools.length > 0)
    assert.ok(tools.every((t) => !t.write))
  })

  // Servers have been rejected by the Anthropic API for invalid JSON Schema (e.g. `required: true` on a property)
  it('publishes valid JSON Schema for every tool', async () => {
    const { client } = await connect({})
    const { tools } = await client.listTools()
    assert.equal(tools.length, TOOLS.length)
    for (const t of tools) {
      assert.equal(t.inputSchema.type, 'object', t.name)
      const walk = (node: unknown, path: string) => {
        if (!node || typeof node !== 'object') return
        for (const [k, v] of Object.entries(node)) {
          if (k === 'required')
            assert.ok(Array.isArray(v), `${t.name}${path}: required must be an array, got ${typeof v}`)
          walk(v, `${path}.${k}`)
        }
      }
      walk(t.inputSchema, '')
    }
  })

  it('marks reads read-only and gated writes destructive', async () => {
    const { client } = await connect({})
    const byName = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]))
    assert.equal(byName.list_products!.annotations?.readOnlyHint, true)
    assert.equal(byName.cancel_order!.annotations?.readOnlyHint, false)
    assert.equal(byName.cancel_order!.annotations?.destructiveHint, true)
    assert.equal(byName.create_product_draft!.annotations?.destructiveHint, false)
  })
})

describe('reads', () => {
  it('pages with a total and where to continue, and sends the token', async () => {
    const t = await connect({ 'GET /products': { items: [product()], total: 45 } })
    const r = await t.call('list_products', { limit: 20 })
    assert.deepEqual(
      { total: r.data.total, returned: r.data.returned, nextOffset: r.data.nextOffset },
      { total: 45, returned: 1, nextOffset: 1 },
    )
    assert.deepEqual(r.data.items[0], {
      id: ID,
      title: 'Mug',
      status: 'draft',
      priceCents: { min: 1500, max: 1500 },
      stock: 3,
      variants: 1,
    })
    assert.equal(t.calls[0]!.auth, 'Bearer sk_test')
  })

  it('ends paging on the last page', async () => {
    const t = await connect({ 'GET /orders': { items: [order()], total: 1 } })
    assert.equal((await t.call('list_orders')).data.nextOffset, null)
  })

  it('maps order filters to the API names', async () => {
    const t = await connect({ 'GET /orders': { items: [], total: 0 } })
    await t.call('list_orders', { paid: 'paid', fulfillment: 'unfulfilled', cancelled: false })
    const url = new URL('http://x' + t.calls[0]!.url)
    assert.equal(url.searchParams.get('financialStatus'), 'paid')
    assert.equal(url.searchParams.get('fulfillmentStatus'), 'unfulfilled')
    assert.equal(url.searchParams.get('cancelled'), 'false')
  })

  it('low_stock lists the lowest variants first, skips archived products, and says it saw everything', async () => {
    const one = (title: string, stock: number, status = 'active') =>
      product({ title, status, variants: [{ id: ID, title: 'x', sku: null, priceCents: 1, inventoryQuantity: stock }] })
    const t = await connect({
      'GET /products': { items: [one('A', 9), one('B', 1), one('C', 4), one('Old', 0, 'archived')], total: 4 },
    })
    const r = await t.call('low_stock', { threshold: 5 })
    assert.equal(r.data.complete, true)
    assert.deepEqual(
      r.data.items.map((i: { product: string }) => i.product),
      ['B', 'C'],
    )
  })
})

describe('untracked stock', () => {
  it('is not low stock, and is shown as not tracked', async () => {
    const untracked = product({
      title: 'Digital',
      status: 'active',
      variants: [{ id: ID, title: 'x', sku: null, priceCents: 1, inventoryQuantity: null }],
    })
    const t = await connect({ 'GET /products': { items: [untracked], total: 1 } })
    const low = await t.call('low_stock', { threshold: 5 })
    assert.equal(low.data.found, 0)
    assert.equal((await t.call('list_products')).data.items[0].stock, 'not tracked')
  })
})

describe('writes', () => {
  it('creates products as drafts, converting the price to cents', async () => {
    const t = await connect({ 'POST /products': product() })
    const r = await t.call('create_product_draft', { title: 'Mug', price: 19.99 })
    assert.deepEqual(t.calls[0]!.body, { title: 'Mug', status: 'draft', priceCents: 1999 })
    assert.equal(r.data.created, true)
  })

  it('creates discounts inactive', async () => {
    const t = await connect({ 'POST /discounts': { id: ID, code: 'SAVE5', active: false } })
    await t.call('create_discount_draft', { code: 'SAVE5', type: 'fixed_amount', value: 5 })
    const body = t.calls[0]!.body as { active: boolean; value: number }
    assert.equal(body.active, false)
    assert.equal(body.value, 500)
  })

  it('publish only previews until confirmed', async () => {
    const t = await connect({
      [`GET /products/${ID}`]: product(),
      [`PATCH /products/${ID}`]: product({ status: 'active' }),
    })
    const dry = await t.call('publish_product', { id: ID })
    assert.equal(dry.data.done, false)
    assert.match(dry.data.message, /confirm: true/)
    assert.deepEqual(
      t.calls.map((c) => c.method),
      ['GET'],
    )

    const done = await t.call('publish_product', { id: ID, confirm: true })
    assert.equal(done.data.done, true)
    assert.deepEqual(t.calls.at(-1)!.body, { status: 'active' })
  })

  it('cancel previews, refuses a repeat, and only then cancels', async () => {
    const t = await connect({ [`GET /orders/${ID}`]: order(), [`POST /orders/${ID}/cancel`]: order() })
    const dry = await t.call('cancel_order', { id: ID, reason: 'customer', restock: true })
    assert.equal(dry.data.done, false)
    assert.ok(t.calls.every((c) => c.method === 'GET'))
    await t.call('cancel_order', { id: ID, reason: 'customer', restock: true, confirm: true })
    assert.deepEqual(t.calls.at(-1)!.body, { reason: 'customer', restock: true })

    const again = await connect({ [`GET /orders/${ID}`]: order({ cancelledAt: '2026-01-02T00:00:00Z' }) })
    const r = await again.call('cancel_order', { id: ID, reason: 'other', restock: false, confirm: true })
    assert.match(r.data.message, /already cancelled/)
    assert.ok(again.calls.every((c) => c.method === 'GET'))
  })

  it('does not ship a cancelled order', async () => {
    const t = await connect({ [`GET /orders/${ID}`]: order({ cancelledAt: '2026-01-02T00:00:00Z' }) })
    const r = await t.call('fulfill_order', { id: ID, confirm: true })
    assert.equal(r.data.done, false)
    assert.ok(t.calls.every((c) => c.method === 'GET'))
  })

  it('read-only servers do not expose writes at all', async () => {
    const t = await connect({}, { readOnly: true })
    const names = (await t.client.listTools()).tools.map((x) => x.name)
    assert.ok(names.includes('list_orders'))
    assert.ok(!names.includes('cancel_order') && !names.includes('create_product_draft'))
    const r = await t.client.callTool({ name: 'cancel_order', arguments: { id: ID, reason: 'other', restock: false } })
    assert.equal(r.isError, true)
    assert.equal(t.calls.length, 0)
  })
})

describe('errors', () => {
  it('turns a missing scope into a message the model can act on', async () => {
    const t = await connect({
      'GET /orders': new Response(JSON.stringify({ message: 'This API token needs the read_orders scope' }), {
        status: 403,
      }),
    })
    const r = await t.call('list_orders')
    assert.equal(r.isError, true)
    assert.match(r.data, /read_orders scope/)
  })

  it('says when the token is rejected', async () => {
    const t = await connect({ 'GET /shop': new Response('{}', { status: 401 }) })
    assert.match((await t.call('get_shop')).data, /token was rejected/)
  })

  it('rejects bad input without calling the API', async () => {
    const t = await connect({})
    const r = await t.client.callTool({ name: 'update_variant', arguments: { variantId: 'nope', price: -1 } })
    assert.equal(r.isError, true)
    assert.equal(t.calls.length, 0)
  })
})
