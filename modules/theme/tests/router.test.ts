// The admin theme routes, called through the real router with fake resolvers and an in-memory database: who may call
// them, and what they do to the library. (The two that fetch the storefront over the network are left out.)
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { configureRpc } = await import('@shopnex/rpc')
const { themeModule } = await import('../src/theme.module')
const { marketplaceThemes, shopThemes } = await import('../src/theme.schema')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const router = themeModule.router
let member = true
const shop = { id: SHOP, storefrontUrl: null } as never

before(async () => {
  await prepareDatabase()
  configureRpc({
    session: () =>
      Promise.resolve(member ? ({ session: { activeOrganizationId: SHOP }, user: { id: 'u1' } } as never) : null),
    adminShop: () => Promise.resolve({ shop, role: 'admin' as const, superAdmin: false }),
    token: () => Promise.resolve(null),
    hasScope: () => false,
  })
})
after(async () => {
  await db.delete(shopThemes).where(eq(shopThemes.shopId, SHOP))
  await db.delete(marketplaceThemes)
})

const ctx = { context: { headers: new Headers() } }
const run = <T>(procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, ctx as never) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
const document = { settings: {}, pages: {} }

describe('who may call', () => {
  test('a signed-out request is UNAUTHORIZED on every kind of route', async () => {
    member = false
    await assert.rejects(run(router.list), refused('UNAUTHORIZED'))
    await assert.rejects(run(router.publish, { id: '00000000-0000-4000-8000-000000000000' }), refused('UNAUTHORIZED'))
    member = true
  })
})

describe('the library through the routes', () => {
  test('ensure adds the shop’s first theme and it goes live; a second ensure of the same theme answers null', async () => {
    await db.delete(shopThemes).where(eq(shopThemes.shopId, SHOP))
    const first = await run<{ id: string; role: string; name: string } | null>(router.ensure, {
      themeId: 'maison',
      name: 'Maison',
      document,
    })
    assert.equal(first?.role, 'live')
    assert.ok(!('draft' in (first ?? {})) && !('shopId' in (first ?? {})))
    assert.equal(await run(router.ensure, { themeId: 'maison', name: 'Maison', document }), null)
    const listed = await run<{ id: string; unpublishedChanges: boolean }[]>(router.list)
    assert.deepEqual(
      listed.map((t) => t.id),
      [first!.id],
    )
    assert.equal(listed[0]!.unpublishedChanges, true)
  })

  test('get answers with the document and without the code files; an unknown id is NOT_FOUND', async () => {
    const id = (await run<{ id: string }[]>(router.list))[0]!.id
    const detail = await run<Record<string, unknown>>(router.get, { id })
    assert.deepEqual(detail.draft, document)
    assert.ok(!('files' in detail))
    await assert.rejects(run(router.get, { id: '00000000-0000-4000-8000-000000000000' }), refused('NOT_FOUND'))
  })

  test('rename, duplicate, saveDraft and publish do what they say, on the right copy', async () => {
    const id = (await run<{ id: string }[]>(router.list))[0]!.id
    assert.equal((await run<{ name: string }>(router.rename, { id, name: 'Renamed' })).name, 'Renamed')
    const copy = await run<{ id: string; name: string; role: string }>(router.duplicate, { id })
    assert.equal(copy.name, 'Copy of Renamed')
    assert.equal(copy.role, 'unpublished')
    const saved = await run<{ updatedAt: Date }>(router.saveDraft, {
      id: copy.id,
      document: { settings: { a: 'b' }, pages: {} },
    })
    assert.ok(saved.updatedAt instanceof Date)
    const published = await run<{ publishedAt: Date }>(router.publish, { id: copy.id })
    assert.ok(published.publishedAt instanceof Date)
    const roles = Object.fromEntries(
      (await run<{ id: string; role: string }[]>(router.list)).map((t) => [t.id, t.role]),
    )
    assert.equal(roles[copy.id], 'live')
    assert.equal(roles[id], 'unpublished')
  })

  test('discardDraft says a theme that was never published was never published', async () => {
    const draftOnly = await run<{ id: string }>(router.duplicate, {
      id: (await run<{ id: string }[]>(router.list))[0]!.id,
    })
    await assert.rejects(
      run(router.discardDraft, { id: draftOnly.id }),
      (e: unknown) => e instanceof ORPCError && e.code === 'NOT_FOUND' && /never published/.test(e.message),
    )
  })

  test('the live theme cannot be deleted, another one can', async () => {
    const all = await run<{ id: string; role: string }[]>(router.list)
    const live = all.find((t) => t.role === 'live')!
    const spare = all.find((t) => t.role !== 'live')!
    await assert.rejects(run(router.delete, { id: live.id }), refused('CONFLICT'))
    assert.deepEqual(await run(router.delete, { id: spare.id }), { id: spare.id })
  })

  test('a code draft: autosave a file, a Liquid error is refused with the problem, a stale revision is a conflict', async () => {
    const live = (await run<{ id: string; role: string }[]>(router.list)).find((t) => t.role === 'live')!
    const first = await run<{ rev: number }>(router.saveFile, {
      id: live.id,
      path: 'snippets/a.liquid',
      source: '<p>hi</p>',
    })
    await run(router.saveFile, { id: live.id, path: 'snippets/b.liquid', source: '<p>b</p>' })
    await assert.rejects(
      run(router.saveFile, { id: live.id, path: 'snippets/bad.liquid', source: '{% if a %}' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST' && /^Liquid error/.test(e.message),
    )
    await assert.rejects(run(router.publishCode, { id: live.id, rev: first.rev }), refused('CONFLICT'))
    const result = await run<{ published: boolean }>(router.publishCode, { id: live.id })
    assert.equal(result.published, true)
    assert.equal(
      (await run<{ rev: number }>(router.deleteFile, { id: live.id, path: 'snippets/a.liquid' })).rev > 0,
      true,
    )
    assert.equal(typeof (await run<{ rev: number }>(router.discardCode, { id: live.id })).rev, 'number')
  })

  test('previewToken gives a token for a copy of this shop, and NOT_FOUND for any other', async () => {
    const id = (await run<{ id: string }[]>(router.list))[0]!.id
    const token = await run<{ token: string; expiresAt: Date }>(router.previewToken, { id })
    assert.match(token.token, /^[\w-]+\.[\w-]+$/)
    await assert.rejects(run(router.previewToken, { id: '00000000-0000-4000-8000-000000000000' }), refused('NOT_FOUND'))
  })

  test('store lists the Theme Store styles without their documents', async () => {
    await db.delete(marketplaceThemes)
    await db.insert(marketplaceThemes).values({
      id: '00000000-0000-4000-8000-0000000000aa',
      slug: 'alpha',
      name: 'Alpha',
      tagline: 'A style',
      developerName: 'Dev',
      baseThemeId: 'maison',
      document: { settings: {}, pages: {} },
      listingUrl: 'https://market.example/alpha',
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    const styles = await run<Record<string, unknown>[]>(router.store)
    assert.deepEqual(
      styles.map((s) => s.name),
      ['Alpha'],
    )
    assert.ok(!('document' in styles[0]!))
  })
})
