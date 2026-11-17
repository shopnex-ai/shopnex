// Running a capability through an installed app: what ShopNex sends (and what it keeps back), what it does with the answer, how a failure
// is kept, and the feedback on a suggestion. Built-in AI calls the provider's own API, so it is not run here.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, SHOP } = fx
const service = (await import('../src')).aiService
type Capability = keyof typeof import('@shopnex/marketplace-sdk/ai').aiCapabilities
// bindConn would lose run's generic, and with it the type of the output
const aiService = {
  run: <C extends Capability>(shopId: string, request: Parameters<typeof service.run<C>>[1]) =>
    service.run(shopId, request, db),
  feedback: (shopId: string, id: string, value: Parameters<typeof service.feedback>[2]) =>
    service.feedback(shopId, id, value, db),
}
const { AiError } = await import('../src/ai.errors')
const { eq } = await import('drizzle-orm')

const refused = (code: string) => (e: unknown) => e instanceof AiError && e.code === code
const generation = async (id: string) =>
  (await db.select().from(schema.aiGenerations).where(eq(schema.aiGenerations.id, id)))[0]

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

describe('run, through an app', () => {
  test('sends the signed request with only what the capability needs, and keeps the generation', async () => {
    const app = await fx.aiApp({ name: 'Writer', capabilities: ['product.description'] })
    const product = await fx.product({ title: 'Linen shirt', vendor: 'Acme', tags: ['summer'] })
    fx.answers({ descriptionHtml: '<p>Soft linen.</p>' }, { model: 'm-1', inputTokens: 10, outputTokens: 20 })

    const result = await aiService.run(SHOP, {
      capability: 'product.description',
      subjectId: product.id,
      input: { tone: 'warm' },
      userId: null,
    })

    assert.deepEqual(result.provider, { id: app.id, name: 'Writer' })
    assert.deepEqual(result.output, { descriptionHtml: '<p>Soft linen.</p>' })
    assert.deepEqual(result.usage, { model: 'm-1', inputTokens: 10, outputTokens: 20 })

    const [call] = fx.received
    assert.equal(call!.path, '/run')
    assert.ok(
      Object.keys(call!.headers).some((h) => /signature/i.test(h)),
      'the request is signed',
    )
    assert.equal(call!.body.kind, 'ai.run')
    assert.equal(call!.body.id, result.id)
    assert.equal(call!.body.shopId, SHOP)
    assert.equal(call!.body.capability, 'product.description')
    assert.deepEqual(call!.body.input, { tone: 'warm' })
    assert.equal(call!.body.subject.type, 'product')
    assert.equal(call!.body.subject.product.title, 'Linen shirt')
    assert.equal(call!.body.subject.product.vendor, 'Acme')
    assert.equal('catalog' in call!.body.shop, false, 'a description does not need the shop’s catalog')

    const row = await generation(result.id)
    assert.equal(row!.status, 'succeeded')
    assert.equal(row!.appId, app.id)
    assert.equal(row!.subjectType, 'product')
    assert.equal(row!.subjectId, product.id)
    assert.equal(row!.feedback, null)
    assert.deepEqual(row!.output, { descriptionHtml: '<p>Soft linen.</p>' })
  })

  test('a capability that organizes the shop gets the catalog too (product.classify, page.content)', async () => {
    await fx.aiApp({ capabilities: ['product.classify', 'page.content'] })
    const product = await fx.product()
    await fx.collection({ slug: 'summer-2026', title: 'Summer 2026' })
    fx.answers({ productType: 'Shirt', tags: [], collections: [] })
    await aiService.run(SHOP, { capability: 'product.classify', subjectId: product.id })
    assert.ok(fx.received[0]!.body.shop.catalog.collections.some((c: { handle: string }) => c.handle === 'summer-2026'))

    fx.received.length = 0
    fx.answers({ title: 'About', bodyHtml: '<p>We sell shirts</p>' })
    await aiService.run(SHOP, { capability: 'page.content', input: { kind: 'about' } })
    assert.ok(fx.received[0]!.body.shop.catalog)
  })

  test('a page that is still being written has no subject, and one that exists is sent as it is', async () => {
    await fx.aiApp({ capabilities: ['page.content'] })
    fx.answers({ title: 'Shipping', bodyHtml: '<p>Ships fast</p>' })
    await aiService.run(SHOP, { capability: 'page.content', input: { kind: 'shipping' } })
    assert.equal(fx.received[0]!.body.subject.page, null)

    const page = await fx.page({ title: 'Shipping', bodyHtml: '<p>Ships in 2 days</p>' })
    await aiService.run(SHOP, { capability: 'page.content', subjectId: page.id, input: { kind: 'shipping' } })
    assert.equal(fx.received[1]!.body.subject.page.title, 'Shipping')
    assert.equal(fx.received[1]!.body.subject.page.body, 'Ships in 2 days')
  })

  test('the user who asked is kept; an API token leaves it empty', async () => {
    await fx.aiApp({ capabilities: ['collection.seo'] })
    const collection = await fx.collection()
    fx.answers({ title: 'Summer', description: 'Shirts for summer' })
    const byToken = await aiService.run(SHOP, { capability: 'collection.seo', subjectId: collection.id })
    assert.equal((await generation(byToken.id))!.userId, null)
    const [staff] = await db
      .insert(schema.user)
      .values({ id: `ai-test-${Date.now()}`, name: 'Staff', email: `ai-test-${Date.now()}@example.test` })
      .returning()
    try {
      const byStaff = await aiService.run(SHOP, {
        capability: 'collection.seo',
        subjectId: collection.id,
        userId: staff!.id,
      })
      assert.equal((await generation(byStaff.id))!.userId, staff!.id)
    } finally {
      await fx.cleanup()
      await db.delete(schema.user).where(eq(schema.user.id, staff!.id))
    }
  })

  test('with several apps the oldest is the default, and the one asked for is used instead', async () => {
    const first = await fx.aiApp({ name: 'First', capabilities: ['product.seo'] })
    const second = await fx.aiApp({ name: 'Second', capabilities: ['product.seo'] })
    const product = await fx.product()
    fx.answers({ title: 'T', description: 'D' })
    const byDefault = await aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id })
    assert.equal(byDefault.provider.id, first.id)
    const asked = await aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id, providerId: second.id })
    assert.equal(asked.provider.id, second.id)
    assert.equal((await generation(asked.id))!.appId, second.id)
  })

  test('an app that was uninstalled is not used', async () => {
    const gone = await fx.aiApp({ installed: false, capabilities: ['product.seo'] })
    const product = await fx.product()
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id }),
      refused('CAPABILITY_UNAVAILABLE'),
    )
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id, providerId: gone.id }),
      refused('CAPABILITY_UNAVAILABLE'),
    )
    assert.equal(fx.received.length, 0)
  })
})

describe('run: refusals before anything is sent', () => {
  test('nothing provides the capability', async () => {
    const product = await fx.product()
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id }),
      refused('CAPABILITY_UNAVAILABLE'),
    )
  })

  test('a provider that does not offer it, or does not exist', async () => {
    const app = await fx.aiApp({ capabilities: ['collection.seo'] })
    const product = await fx.product()
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id, providerId: app.id }),
      refused('CAPABILITY_UNAVAILABLE'),
    )
  })

  test('a product capability needs a product, which has to be this shop’s', async () => {
    await fx.aiApp({ capabilities: ['product.seo'] })
    await assert.rejects(aiService.run(SHOP, { capability: 'product.seo' }), refused('SUBJECT_REQUIRED'))
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: '00000000-0000-4000-8000-000000000000' }),
      refused('SUBJECT_NOT_FOUND'),
    )
    assert.equal(fx.received.length, 0)
  })

  test('a collection and a page that do not exist', async () => {
    await fx.aiApp({ capabilities: ['collection.seo', 'page.content'] })
    const missing = '00000000-0000-4000-8000-000000000000'
    await assert.rejects(
      aiService.run(SHOP, { capability: 'collection.seo', subjectId: missing }),
      refused('SUBJECT_NOT_FOUND'),
    )
    await assert.rejects(
      aiService.run(SHOP, { capability: 'page.content', subjectId: missing, input: { kind: 'faq' } }),
      refused('SUBJECT_NOT_FOUND'),
    )
  })

  test('an input the capability does not accept is rejected', async () => {
    await fx.aiApp({ capabilities: ['product.description'] })
    const product = await fx.product()
    await assert.rejects(
      aiService.run(SHOP, {
        capability: 'product.description',
        subjectId: product.id,
        input: { tone: 'sarcastic' } as never,
      }),
    )
  })
})

describe('run: what comes back is cleaned', () => {
  test('descriptions are sanitized like any other', async () => {
    await fx.aiApp({ capabilities: ['product.description'] })
    const product = await fx.product()
    fx.answers({ descriptionHtml: '<p>Nice</p><script>alert(1)</script>' })
    const { output } = await aiService.run(SHOP, { capability: 'product.description', subjectId: product.id })
    assert.ok(!/script/i.test(output.descriptionHtml))
    assert.ok(output.descriptionHtml.includes('<p>Nice</p>'))
  })

  test('image text can only name images the product has, once each', async () => {
    await fx.aiApp({ capabilities: ['product.image_alt'] })
    const product = await fx.product()
    await db
      .insert(schema.productImages)
      .values({ productId: product.id, url: 'https://img.example/a.jpg', position: 0 })
    fx.answers({
      images: [
        { position: 0, alt: 'A shirt' },
        { position: 0, alt: 'Again' },
        { position: 1, alt: 'One past the last image' },
        { position: 5, alt: 'Not there' },
      ],
    })
    const { output } = await aiService.run(SHOP, { capability: 'product.image_alt', subjectId: product.id })
    assert.deepEqual(output.images, [{ position: 0, alt: 'A shirt' }])
  })

  test('a classification only names collections that exist, tags once each', async () => {
    await fx.aiApp({ capabilities: ['product.classify'] })
    const product = await fx.product()
    await fx.collection({ slug: 'real-one' })
    fx.answers({ productType: 'Shirt', tags: ['a', ' a ', 'b'], collections: ['real-one', 'invented', 'real-one'] })
    const { output } = await aiService.run(SHOP, { capability: 'product.classify', subjectId: product.id })
    assert.deepEqual(output, { productType: 'Shirt', tags: ['a', 'b'], collections: ['real-one'] })
  })

  test('a page body drops a first heading that only repeats the title', async () => {
    await fx.aiApp({ capabilities: ['page.content'] })
    fx.answers({ title: 'Shipping', bodyHtml: '<h2>Shipping</h2><p>We ship in 2 days.</p>' })
    const same = await aiService.run(SHOP, { capability: 'page.content', input: { kind: 'shipping' } })
    assert.equal(same.output.bodyHtml, '<p>We ship in 2 days.</p>')
    fx.answers({ title: 'Shipping', bodyHtml: '<h2>Delivery times</h2><p>We ship in 2 days.</p>' })
    const other = await aiService.run(SHOP, { capability: 'page.content', input: { kind: 'shipping' } })
    assert.ok(other.output.bodyHtml.startsWith('<h2>Delivery times</h2>'))
  })
})

describe('run: when the provider fails', () => {
  const lastFailed = async () =>
    (await db.select().from(schema.aiGenerations).where(eq(schema.aiGenerations.status, 'failed')))[0]

  test('the app explains it as { error }: staff read that, and the failed run is kept', async () => {
    const app = await fx.aiApp({ name: 'Writer', capabilities: ['product.seo'] })
    const product = await fx.product()
    fx.fails(500, { error: 'model overloaded' })
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id }),
      (e: unknown) =>
        e instanceof AiError &&
        e.code === 'PROVIDER_FAILED' &&
        e.message === "Writer couldn't do this: model overloaded",
    )
    const row = await lastFailed()
    assert.equal(row!.errorMessage, 'model overloaded')
    assert.equal(row!.appId, app.id)
    assert.equal(row!.output, null)
  })

  test('an answer that is not the capability’s output is a failure too', async () => {
    await fx.aiApp({ capabilities: ['product.seo'] })
    const product = await fx.product()
    fx.answers({ title: 'only a title' })
    await assert.rejects(
      aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id }),
      refused('PROVIDER_FAILED'),
    )
    assert.match((await lastFailed())!.errorMessage ?? '', /doesn't match product\.seo/)
  })
})

describe('feedback', () => {
  async function succeeded() {
    await fx.aiApp({ capabilities: ['product.seo'] })
    const product = await fx.product()
    fx.answers({ title: 'T', description: 'D' })
    return aiService.run(SHOP, { capability: 'product.seo', subjectId: product.id })
  }

  test('records whether staff used the suggestion, and can be changed', async () => {
    const { id } = await succeeded()
    assert.deepEqual(await aiService.feedback(SHOP, id, 'accepted'), { id, feedback: 'accepted' })
    assert.deepEqual(await aiService.feedback(SHOP, id, 'rejected'), { id, feedback: 'rejected' })
    assert.equal((await generation(id))!.feedback, 'rejected')
  })

  test('not for a generation that does not exist, belongs to another shop, or failed', async () => {
    await assert.rejects(
      aiService.feedback(SHOP, '00000000-0000-4000-8000-000000000000', 'accepted'),
      refused('GENERATION_NOT_FOUND'),
    )
    const { id } = await succeeded()
    await assert.rejects(aiService.feedback('another-shop', id, 'accepted'), refused('GENERATION_NOT_FOUND'))
    await db.update(schema.aiGenerations).set({ status: 'failed' }).where(eq(schema.aiGenerations.id, id))
    await assert.rejects(aiService.feedback(SHOP, id, 'accepted'), refused('GENERATION_NOT_FOUND'))
  })
})
