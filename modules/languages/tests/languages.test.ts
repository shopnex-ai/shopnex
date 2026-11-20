// Published languages and translations on a real in-memory database (PGlite), the way the app runs them.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shops } from '@shopnex/core/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { LanguageError, languageService: languages, MAX_LANGUAGES } = await import('../src')
const { canonicalLanguage, sourceDigest } = await import('../src/languages.contract')
const { optionNameField, optionValueField, shopLanguages, translations } = await import('../src/languages.schema')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const OTHER = 'other-shop'
const product = randomUUID()

before(async () => {
  await prepareDatabase()
  await db.insert(shops).values({ id: OTHER, name: 'Other', slug: OTHER }).onConflictDoNothing()
})
beforeEach(async () => {
  for (const shop of [SHOP, OTHER]) {
    await db.delete(translations).where(eq(translations.shopId, shop))
    await db.delete(shopLanguages).where(eq(shopLanguages.shopId, shop))
  }
})
after(async () => {
  await db.delete(shops).where(eq(shops.id, OTHER))
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

const rejectsWith = (code: 'LANGUAGE_NOT_PUBLISHED' | 'INVALID_FIELD' | 'TOO_MANY_LANGUAGES', work: Promise<unknown>) =>
  assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof LanguageError, String(error))
    assert.equal(error.code, code)
    return true
  })

const title = (language: string, value: string, source = 'Red shirt', id = product) =>
  languages.translate(SHOP, { resource: 'product', resourceId: id, language, field: 'title', value, source }, db)

describe('published languages', () => {
  test('a shop has its own language and publishes others', async () => {
    assert.deepEqual(await languages.list(SHOP, db), { default: 'en', languages: [] })
    await languages.publish(SHOP, 'fr', db)
    assert.deepEqual(await languages.publish(SHOP, 'de', db), { default: 'en', languages: ['de', 'fr'] })
  })

  test('publishing the default or a published language again changes nothing', async () => {
    await languages.publish(SHOP, 'fr', db)
    await languages.publish(SHOP, 'fr', db)
    assert.deepEqual(await languages.publish(SHOP, 'en', db), { default: 'en', languages: ['fr'] })
  })

  test('there is a limit, and unpublishing makes room', async () => {
    const codes = Array.from({ length: MAX_LANGUAGES }, (_, i) => `x${String.fromCharCode(97 + i)}`)
    for (const code of codes) await languages.publish(SHOP, code, db)
    await rejectsWith('TOO_MANY_LANGUAGES', languages.publish(SHOP, 'fr', db))
    await languages.unpublish(SHOP, codes[0]!, db)
    assert.equal((await languages.publish(SHOP, 'fr', db)).languages.length, MAX_LANGUAGES)
  })

  test('another shop sees none of it', async () => {
    await languages.publish(SHOP, 'fr', db)
    assert.deepEqual((await languages.list(OTHER, db)).languages, [])
  })
})

describe('translations', () => {
  beforeEach(async () => {
    await languages.publish(SHOP, 'fr', db)
  })

  test('sets, changes and lists a translated field', async () => {
    const first = await title('fr', 'Chemise rouge')
    assert.equal(first?.value, 'Chemise rouge')
    await title('fr', 'Chemise écarlate')
    const rows = await languages.translationsOf(SHOP, 'product', product, undefined, db)
    assert.deepEqual(
      rows.map((r) => [r.language, r.field, r.value]),
      [['fr', 'title', 'Chemise écarlate']],
    )
  })

  test('it keeps a fingerprint of the source, which changes when the source text does', async () => {
    const a = await title('fr', 'Chemise rouge', 'Red shirt')
    assert.equal(a?.sourceDigest, sourceDigest('Red shirt'))
    const b = await title('fr', 'Chemise rouge', 'Red shirt, now cotton')
    assert.notEqual(b?.sourceDigest, a?.sourceDigest)
  })

  test('an empty text removes the translation', async () => {
    await title('fr', 'Chemise rouge')
    assert.equal(await title('fr', '  '), null)
    assert.deepEqual(await languages.translationsOf(SHOP, 'product', product, 'fr', db), [])
  })

  test('only a published language, and only the fields a record has, can be translated', async () => {
    await rejectsWith('LANGUAGE_NOT_PUBLISHED', title('de', 'Rotes Hemd'))
    await rejectsWith('LANGUAGE_NOT_PUBLISHED', title('en', 'Red shirt'))
    await rejectsWith(
      'INVALID_FIELD',
      languages.translate(
        SHOP,
        { resource: 'product', resourceId: product, language: 'fr', field: 'body', value: 'x', source: 'y' },
        db,
      ),
    )
  })

  test('a product’s option names and option values, by id, can be translated; nothing else can, and nothing on other records', async () => {
    const color = randomUUID()
    const red = randomUUID()
    const field = (f: string, resource: 'product' | 'collection' = 'product') =>
      languages.translate(
        SHOP,
        { resource, resourceId: product, language: 'fr', field: f, value: 'x', source: 'y' },
        db,
      )
    assert.equal((await field(optionNameField(color)))?.field, optionNameField(color))
    assert.equal((await field(optionValueField(red)))?.field, optionValueField(red))
    await rejectsWith('INVALID_FIELD', field(optionNameField(color), 'collection'))
    for (const bad of ['option_name:', 'option_name:not-a-uuid', `option_value:${red}:extra`, `variant:${red}`]) {
      await rejectsWith('INVALID_FIELD', field(bad))
    }
  })

  test('unpublishing keeps the translations: publishing again brings them back', async () => {
    await title('fr', 'Chemise rouge')
    await languages.unpublish(SHOP, 'fr', db)
    assert.equal((await languages.translationsOf(SHOP, 'product', product, 'fr', db)).length, 1)
    await languages.publish(SHOP, 'fr', db)
    assert.equal(
      (await languages.forResources(SHOP, 'product', [product], 'fr', db)).get(product)?.title,
      'Chemise rouge',
    )
  })

  test('forResources answers the translated fields of many records at once; a record without any is absent', async () => {
    const other = randomUUID()
    await title('fr', 'Chemise rouge')
    await languages.translate(
      SHOP,
      {
        resource: 'product',
        resourceId: product,
        language: 'fr',
        field: 'description',
        value: 'Coton',
        source: 'Cotton',
      },
      db,
    )
    const found = await languages.forResources(SHOP, 'product', [product, other], 'fr', db)
    assert.deepEqual(found.get(product), { title: 'Chemise rouge', description: 'Coton' })
    assert.equal(found.has(other), false)
    assert.equal((await languages.forResources(SHOP, 'product', [], 'fr', db)).size, 0)
    assert.equal((await languages.forResources(SHOP, 'collection', [product], 'fr', db)).size, 0)
  })

  test('statusOf lists the fingerprint of every translated field of one kind of record in one language', async () => {
    const other = randomUUID()
    await languages.publish(SHOP, 'de', db)
    await title('fr', 'Chemise rouge', 'Red shirt')
    await title('fr', 'Chemise bleue', 'Blue shirt', other)
    await languages.translate(
      SHOP,
      {
        resource: 'product',
        resourceId: product,
        language: 'de',
        field: 'title',
        value: 'Rotes Hemd',
        source: 'Red shirt',
      },
      db,
    )
    await languages.translate(
      SHOP,
      { resource: 'page', resourceId: product, language: 'fr', field: 'title', value: 'À propos', source: 'About' },
      db,
    )
    const rows = await languages.statusOf(SHOP, 'product', 'fr', db)
    assert.deepEqual(
      rows.map((r) => [r.resourceId, r.field, r.sourceDigest]).sort(),
      [
        [product, 'title', sourceDigest('Red shirt')],
        [other, 'title', sourceDigest('Blue shirt')],
      ].sort(),
    )
    assert.equal((await languages.statusOf(OTHER, 'product', 'fr', db)).length, 0)
  })

  test('another shop never sees them, and removeFor deletes a record’s translations', async () => {
    await title('fr', 'Chemise rouge')
    assert.equal((await languages.forResources(OTHER, 'product', [product], 'fr', db)).size, 0)
    await languages.removeFor(OTHER, 'product', product, db)
    assert.equal(await languages.countFor(SHOP, db), 1)
    await languages.removeFor(SHOP, 'product', product, db)
    assert.equal(await languages.countFor(SHOP, db), 0)
  })
})

describe('language tags', () => {
  test('canonicalLanguage', () => {
    assert.equal(canonicalLanguage('EN'), 'en')
    assert.equal(canonicalLanguage(' pt-br '), 'pt-BR')
    for (const bad of ['', 'e', 'english', 'und', '12', 'fr_FR']) assert.equal(canonicalLanguage(bad), null, bad)
  })
  test('sourceDigest is stable and tells texts apart', () => {
    assert.equal(sourceDigest('Red shirt'), sourceDigest('Red shirt'))
    assert.notEqual(sourceDigest('Red shirt'), sourceDigest('Red shirt '))
    assert.notEqual(sourceDigest(''), sourceDigest(' '))
  })
})
