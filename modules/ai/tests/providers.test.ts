// Who provides AI capabilities in a shop: what an app registers (and may not), who counts as installed, and what staff are offered.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, SHOP } = fx
const { bindConn } = await import('@shopnex/kit')
const aiProviderService = bindConn((await import('../src')).aiProviderService, db)
const { BUILTIN } = await import('../src')
const { AiError } = await import('../src/ai.errors')
const { encryptSecret } = await import('@shopnex/db/secrets')
const { eq } = await import('drizzle-orm')

const refused = (code: string) => (e: unknown) => e instanceof AiError && e.code === code

before(async () => {
  await fx.prepareDatabase()
  await fx.startFakeApp()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetFakeApp()
})
after(async () => {
  await fx.cleanup()
  await fx.stopFakeApp()
})

describe('configure: what an app provides in a shop', () => {
  test('registers the capabilities it names, on its own origin, listed by capability', async () => {
    const app = await fx.aiApp()
    const rows = await aiProviderService.configure(SHOP, app.id, {
      capabilities: { 'product.seo': `${fx.appUrl}/seo`, 'product.description': `${fx.appUrl}/desc` },
    })
    assert.deepEqual(
      rows.map((r) => [r.capability, r.url, r.shopId, r.appId]),
      [
        ['product.description', `${fx.appUrl}/desc`, SHOP, app.id],
        ['product.seo', `${fx.appUrl}/seo`, SHOP, app.id],
      ],
    )
  })

  test('configuring again replaces: what is left out is removed, what stays gets the new url, still one row each', async () => {
    const app = await fx.aiApp()
    await aiProviderService.configure(SHOP, app.id, {
      capabilities: { 'product.seo': `${fx.appUrl}/a`, 'collection.seo': `${fx.appUrl}/b` },
    })
    const rows = await aiProviderService.configure(SHOP, app.id, { capabilities: { 'product.seo': `${fx.appUrl}/c` } })
    assert.deepEqual(
      rows.map((r) => [r.capability, r.url]),
      [['product.seo', `${fx.appUrl}/c`]],
    )
    const all = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.appId, app.id))
    assert.equal(all.length, 1)
  })

  test('naming nothing removes everything the app provided, and only its own', async () => {
    const one = await fx.aiApp({ name: 'One', capabilities: ['product.seo'] })
    const two = await fx.aiApp({ name: 'Two', capabilities: ['product.seo'] })
    assert.deepEqual(await aiProviderService.configure(SHOP, one.id, { capabilities: {} }), [])
    const left = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.appId, two.id))
    assert.equal(left.length, 1)
  })

  test('a url on another origin is refused, and nothing is saved', async () => {
    const app = await fx.aiApp({ capabilities: ['product.seo'] })
    await assert.rejects(
      aiProviderService.configure(SHOP, app.id, { capabilities: { 'product.seo': 'https://evil.example/run' } }),
      refused('INVALID_PROVIDER_URL'),
    )
    await assert.rejects(
      aiProviderService.configure(SHOP, app.id, { capabilities: { 'product.seo': 'ftp://127.0.0.1/run' } }),
      refused('INVALID_PROVIDER_URL'),
    )
    const rows = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.appId, app.id))
    assert.deepEqual(
      rows.map((r) => r.url),
      [`${fx.appUrl}/run`],
    )
  })

  test('an app that does not exist cannot provide anything', async () => {
    await assert.rejects(
      aiProviderService.configure(SHOP, '00000000-0000-4000-8000-000000000000', { capabilities: {} }),
      refused('NOT_AN_AI_APP'),
    )
  })
})

describe('providers: apps still installed', () => {
  test('lists an installed app, oldest first, and hides an uninstalled one', async () => {
    const first = await fx.aiApp({ name: 'First', capabilities: ['product.seo'] })
    await fx.aiApp({ name: 'Gone', installed: false, capabilities: ['product.seo'] })
    const second = await fx.aiApp({ name: 'Second', capabilities: ['product.seo'] })
    const rows = await aiProviderService.providers(SHOP, undefined)
    assert.deepEqual(
      rows.map((r) => r.app.id),
      [first.id, second.id],
    )
  })

  test('can be narrowed to the capabilities asked for', async () => {
    await fx.aiApp({ capabilities: ['product.seo'] })
    assert.equal((await aiProviderService.providers(SHOP, ['collection.seo'])).length, 0)
    assert.equal((await aiProviderService.providers(SHOP, ['product.seo'])).length, 1)
  })
})

describe('available: what staff can use', () => {
  const settings = (enabled: boolean) =>
    db.insert(schema.aiSettings).values({
      shopId: SHOP,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: encryptSecret('sk-test'),
      enabled,
    })

  test('with built-in AI off, only the capabilities some app provides, each with its apps', async () => {
    const app = await fx.aiApp({ name: 'Writer', capabilities: ['product.seo', 'page.content'] })
    const list = await aiProviderService.available(SHOP)
    assert.deepEqual(
      list.map((c) => [c.capability, c.providers.map((p) => p.name)]),
      [
        ['product.seo', ['Writer']],
        ['page.content', ['Writer']],
      ],
    )
    assert.equal(list[0]!.providers[0]!.id, app.id)
  })

  test('with built-in AI on, it provides every capability and comes first', async () => {
    await settings(true)
    await fx.aiApp({ name: 'Writer', capabilities: ['product.seo'] })
    const list = await aiProviderService.available(SHOP)
    assert.equal(list.length, 7)
    const seo = list.find((c) => c.capability === 'product.seo')!
    assert.deepEqual(
      seo.providers.map((p) => [p.id, p.name]),
      [
        [BUILTIN, 'Claude'],
        [seo.providers[1]!.id, 'Writer'],
      ],
    )
    assert.deepEqual(
      list.find((c) => c.capability === 'page.content')!.providers.map((p) => p.id),
      ['builtin'],
    )
  })

  test('built-in AI that is turned off provides nothing', async () => {
    await settings(false)
    assert.deepEqual(await aiProviderService.available(SHOP), [])
  })
})
