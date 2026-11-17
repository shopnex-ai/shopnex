// The theme library on a real in-memory database (PGlite): copies of a theme, the one live copy per shop, drafts and
// publishing, the Liquid files and their own draft, and the Theme Store catalog. Every call is scoped by the shop.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { DraftConflictError, draftService, entityDrafts } = await import('@shopnex/drafts')
const themes = await import('../src/themes')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const OTHER = 'some-other-shop'
const doc = (title: string) => ({ settings: { title }, pages: {} })
const later = () => new Promise((resolve) => setTimeout(resolve, 15))

before(async () => {
  await prepareDatabase()
})

const clean = async () => {
  await db.delete(schema.shopThemes).where(eq(schema.shopThemes.shopId, SHOP))
  await db.delete(entityDrafts).where(eq(entityDrafts.shopId, SHOP))
}
beforeEach(clean)
after(async () => {
  await clean()
  await db.delete(schema.marketplaceThemes)
})

describe('creating copies', () => {
  test('the first copy of a shop goes live at once, the next ones do not', async () => {
    const first = await themes.create(SHOP, { themeId: 'maison', name: 'Maison', draft: doc('a') }, db)
    const second = await themes.create(SHOP, { themeId: 'maison', name: 'Another', draft: doc('b') }, db)
    assert.equal(first.role, 'live')
    assert.equal(second.role, 'unpublished')
  })

  test('ensure adds a theme the shop has none of, and answers null when it already has a copy', async () => {
    const added = await themes.ensure(SHOP, { themeId: 'maison', name: 'Maison', draft: doc('a') }, db)
    assert.equal(added?.themeId, 'maison')
    assert.equal(await themes.ensure(SHOP, { themeId: 'maison', name: 'Again', draft: doc('a') }, db), null)
    const other = await themes.ensure(SHOP, { themeId: 'shopco', name: 'Shopco', draft: doc('c') }, db)
    assert.equal(other?.role, 'unpublished')
  })

  test('two writers racing for the first copy still leave exactly one live', async () => {
    await Promise.all([
      themes.create(SHOP, { themeId: 'a', name: 'A', draft: doc('a') }, db),
      themes.create(SHOP, { themeId: 'b', name: 'B', draft: doc('b') }, db),
    ])
    const rows = await themes.list(SHOP, db)
    assert.deepEqual(rows.map((r) => r.role).sort(), ['live', 'unpublished'])
  })
})

describe('the library', () => {
  test('lists the live copy first, then the others newest first, without their documents', async () => {
    const live = await themes.create(SHOP, { themeId: 'maison', name: 'Live', draft: doc('a') }, db)
    await later()
    const older = await themes.create(SHOP, { themeId: 'maison', name: 'Older', draft: doc('b') }, db)
    await later()
    const newer = await themes.create(SHOP, { themeId: 'maison', name: 'Newer', draft: doc('c') }, db)
    const rows = await themes.list(SHOP, db)
    assert.deepEqual(
      rows.map((r) => r.id),
      [live.id, newer.id, older.id],
    )
    assert.ok(!('draft' in rows[0]!) && !('files' in rows[0]!))
  })

  test('says whether a copy has unpublished changes: never published, edited since, or code in its draft', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    const flag = async () => (await themes.list(SHOP, db)).find((r) => r.id === copy.id)!.unpublishedChanges
    assert.equal(await flag(), true)
    await themes.publish(SHOP, copy.id, db)
    assert.equal(await flag(), false)
    await themes.saveDraft(SHOP, copy.id, doc('edited'), db)
    assert.equal(await flag(), true)
    await themes.discardDraft(SHOP, copy.id, db)
    assert.equal(await flag(), false)
    await themes.saveFile(SHOP, copy.id, 'snippets/x.liquid', 'x', db)
    assert.equal(await flag(), true)
  })

  test('getLive is the live copy with what it published, and null when the shop has no themes', async () => {
    assert.equal(await themes.getLive(SHOP, db), null)
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    let live = await themes.getLive(SHOP, db)
    assert.equal(live?.id, copy.id)
    assert.equal(live?.published, null)
    assert.equal(live?.hasFiles, false)
    await themes.publish(SHOP, copy.id, db)
    await themes.saveFile(SHOP, copy.id, 'snippets/x.liquid', 'x', db)
    await themes.publishCode(SHOP, copy.id, undefined, db)
    live = await themes.getLive(SHOP, db)
    assert.deepEqual(live?.published, doc('a'))
    assert.equal(live?.hasFiles, true)
    assert.equal(live?.filesVersion, 1)
  })
})

describe('drafts and publishing', () => {
  test('saveDraft changes only the draft; publish copies it to what storefronts see and makes the copy live', async () => {
    const live = await themes.create(SHOP, { themeId: 'maison', name: 'Live', draft: doc('a') }, db)
    const other = await themes.create(SHOP, { themeId: 'maison', name: 'Other', draft: doc('b') }, db)
    await themes.saveDraft(SHOP, other.id, doc('b2'), db)
    assert.equal((await themes.get(SHOP, other.id, db))?.published, null)
    const published = await themes.publish(SHOP, other.id, db)
    assert.equal(published?.role, 'live')
    assert.deepEqual(published?.published, doc('b2'))
    assert.ok(published?.publishedAt)
    assert.equal((await themes.get(SHOP, live.id, db))?.role, 'unpublished')
    assert.equal((await themes.getLive(SHOP, db))?.id, other.id)
  })

  test('publishing something that is not there is null and changes nothing', async () => {
    const live = await themes.create(SHOP, { themeId: 'maison', name: 'Live', draft: doc('a') }, db)
    assert.equal(await themes.publish(SHOP, '00000000-0000-4000-8000-000000000000', db), null)
    assert.equal((await themes.get(SHOP, live.id, db))?.role, 'live')
  })

  test('discardDraft goes back to the published copy, and is null for one never published', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    assert.equal(await themes.discardDraft(SHOP, copy.id, db), null)
    await themes.publish(SHOP, copy.id, db)
    await themes.saveDraft(SHOP, copy.id, doc('edited'), db)
    const back = await themes.discardDraft(SHOP, copy.id, db)
    assert.deepEqual(back?.draft, doc('a'))
  })

  test('rename changes the name only', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'Old', draft: doc('a') }, db)
    const renamed = await themes.rename(SHOP, copy.id, 'New', db)
    assert.equal(renamed?.name, 'New')
    assert.deepEqual(renamed?.draft, doc('a'))
  })

  test('duplicate makes an unpublished copy of the draft, files and code draft, named after the original', async () => {
    const source = await themes.create(SHOP, { themeId: 'maison', name: 'Maison', draft: doc('a') }, db)
    await themes.saveFile(SHOP, source.id, 'snippets/a.liquid', 'A', db)
    await themes.publishCode(SHOP, source.id, undefined, db)
    await themes.saveFile(SHOP, source.id, 'snippets/b.liquid', 'B', db)
    const copy = await themes.duplicate(SHOP, source.id, undefined, db)
    assert.equal(copy?.name, 'Copy of Maison')
    assert.equal(copy?.role, 'unpublished')
    assert.equal(copy?.themeId, 'maison')
    assert.deepEqual(copy?.draft, doc('a'))
    assert.deepEqual(copy?.files, { 'snippets/a.liquid': 'A' })
    assert.deepEqual((await draftService.get(SHOP, themes.CODE_DRAFT, copy!.id, db)).changes, {
      'snippets/b.liquid': 'B',
    })
    assert.equal((await themes.duplicate(SHOP, source.id, 'Mine', db))?.name, 'Mine')
    assert.equal(await themes.duplicate(SHOP, '00000000-0000-4000-8000-000000000000', undefined, db), null)
  })

  test('the live copy cannot be removed; another one can, and its code draft goes with it', async () => {
    const live = await themes.create(SHOP, { themeId: 'maison', name: 'Live', draft: doc('a') }, db)
    const spare = await themes.create(SHOP, { themeId: 'maison', name: 'Spare', draft: doc('b') }, db)
    await themes.saveFile(SHOP, spare.id, 'snippets/a.liquid', 'A', db)
    assert.equal(await themes.remove(SHOP, live.id, db), null)
    assert.deepEqual(await themes.remove(SHOP, spare.id, db), { id: spare.id })
    assert.equal(await themes.get(SHOP, spare.id, db), null)
    assert.deepEqual(await draftService.get(SHOP, themes.CODE_DRAFT, spare.id, db), { changes: {}, rev: 0 })
    assert.equal(await themes.remove(SHOP, spare.id, db), null)
  })
})

describe('the Liquid files', () => {
  test('edits go to a draft, the preview sees them over the published files, and publishing writes them', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    const first = await themes.saveFile(SHOP, copy.id, 'snippets/a.liquid', 'A', db)
    const second = await themes.saveFile(SHOP, copy.id, 'snippets/b.liquid', 'B', db)
    assert.ok(first && second && second.rev > first.rev)
    assert.deepEqual((await themes.get(SHOP, copy.id, db))?.files, {})
    const preview = await themes.codeDraft(SHOP, (await themes.get(SHOP, copy.id, db))!, db)
    assert.deepEqual(preview.files, { 'snippets/a.liquid': 'A', 'snippets/b.liquid': 'B' })
    assert.deepEqual(preview.changed.sort(), ['snippets/a.liquid', 'snippets/b.liquid'])
    assert.equal(preview.rev, second.rev)
    assert.equal(preview.version, 0 + second.rev)

    const result = await themes.publishCode(SHOP, copy.id, second.rev, db)
    assert.equal(result?.published, true)
    const after = await themes.get(SHOP, copy.id, db)
    assert.deepEqual(after?.files, { 'snippets/a.liquid': 'A', 'snippets/b.liquid': 'B' })
    assert.equal(after?.filesVersion, 1)
    assert.deepEqual((await themes.codeDraft(SHOP, after!, db)).changed, [])
  })

  test('publishing with nothing in the draft publishes nothing and does not bump the version', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    assert.equal((await themes.publishCode(SHOP, copy.id, undefined, db))?.published, false)
    assert.equal((await themes.get(SHOP, copy.id, db))?.filesVersion, 0)
  })

  test('a stale tab cannot publish what it has not seen: a revision that is not the current one is a conflict', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    const saved = await themes.saveFile(SHOP, copy.id, 'snippets/a.liquid', 'A', db)
    await themes.saveFile(SHOP, copy.id, 'snippets/b.liquid', 'B', db)
    await assert.rejects(themes.publishCode(SHOP, copy.id, saved!.rev, db), DraftConflictError)
    assert.deepEqual((await themes.get(SHOP, copy.id, db))?.files, {})
  })

  test('a null source puts the theme’s own file back: it is removed from the published files', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    await themes.saveFile(SHOP, copy.id, 'snippets/a.liquid', 'A', db)
    await themes.publishCode(SHOP, copy.id, undefined, db)
    await themes.saveFile(SHOP, copy.id, 'snippets/a.liquid', null, db)
    await themes.publishCode(SHOP, copy.id, undefined, db)
    const after = await themes.get(SHOP, copy.id, db)
    assert.deepEqual(after?.files, {})
    assert.equal(after?.filesVersion, 2)
  })

  test('discardCode drops the draft and leaves the published files', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    await themes.saveFile(SHOP, copy.id, 'snippets/a.liquid', 'A', db)
    await themes.publishCode(SHOP, copy.id, undefined, db)
    await themes.saveFile(SHOP, copy.id, 'snippets/b.liquid', 'B', db)
    await themes.discardCode(SHOP, copy.id, db)
    const after = await themes.get(SHOP, copy.id, db)
    assert.deepEqual(after?.files, { 'snippets/a.liquid': 'A' })
    assert.deepEqual((await themes.codeDraft(SHOP, after!, db)).changed, [])
  })
})

describe('one shop never reaches another’s copies', () => {
  test('every call with another shop’s id finds nothing and changes nothing', async () => {
    const copy = await themes.create(SHOP, { themeId: 'maison', name: 'M', draft: doc('a') }, db)
    assert.deepEqual(await themes.list(OTHER, db), [])
    assert.equal(await themes.get(OTHER, copy.id, db), null)
    assert.equal(await themes.getLive(OTHER, db), null)
    assert.equal(await themes.saveDraft(OTHER, copy.id, doc('x'), db), null)
    assert.equal(await themes.publish(OTHER, copy.id, db), null)
    assert.equal(await themes.discardDraft(OTHER, copy.id, db), null)
    assert.equal(await themes.duplicate(OTHER, copy.id, undefined, db), null)
    assert.equal(await themes.rename(OTHER, copy.id, 'x', db), null)
    assert.equal(await themes.remove(OTHER, copy.id, db), null)
    assert.equal(await themes.saveFile(OTHER, copy.id, 'a', 'x', db), null)
    assert.equal(await themes.publishCode(OTHER, copy.id, undefined, db), null)
    assert.equal(await themes.discardCode(OTHER, copy.id, db), null)
    const still = await themes.get(SHOP, copy.id, db)
    assert.equal(still?.name, 'M')
    assert.deepEqual(still?.draft, doc('a'))
  })
})

describe('the Theme Store', () => {
  const style = (id: string, name: string) => ({
    id,
    slug: name.toLowerCase(),
    name,
    tagline: `${name} tagline`,
    developerName: 'A developer',
    baseThemeId: 'maison',
    document: doc(name),
    listingUrl: `https://market.example/${name.toLowerCase()}`,
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  })

  test('lists the styles by name without their documents, and gets one with its document', async () => {
    await db.delete(schema.marketplaceThemes)
    await db
      .insert(schema.marketplaceThemes)
      .values([
        style('00000000-0000-4000-8000-0000000000b2', 'Bravo'),
        style('00000000-0000-4000-8000-0000000000a1', 'Alpha'),
      ])
    const listed = await themes.listStore(db)
    assert.deepEqual(
      listed.map((s) => s.name),
      ['Alpha', 'Bravo'],
    )
    assert.ok(!('document' in listed[0]!))
    assert.equal(listed[0]!.listingUrl, 'https://market.example/alpha')
    const one = await themes.getStoreTheme('00000000-0000-4000-8000-0000000000b2', db)
    assert.deepEqual(one?.document, doc('Bravo'))
    assert.equal(await themes.getStoreTheme('00000000-0000-4000-8000-0000000000ff', db), null)
  })

  test('a copy added from a style remembers it, and keeps working when the style is delisted (no foreign key)', async () => {
    await db.delete(schema.marketplaceThemes)
    await db.insert(schema.marketplaceThemes).values(style('00000000-0000-4000-8000-0000000000c3', 'Charlie'))
    const copy = await themes.create(
      SHOP,
      {
        themeId: 'maison',
        name: 'Charlie',
        draft: doc('Charlie'),
        marketplaceThemeId: '00000000-0000-4000-8000-0000000000c3',
      },
      db,
    )
    await db.delete(schema.marketplaceThemes)
    const row = (await themes.list(SHOP, db)).find((r) => r.id === copy.id)
    assert.equal(row?.marketplaceThemeId, '00000000-0000-4000-8000-0000000000c3')
  })
})
