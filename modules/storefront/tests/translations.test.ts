// Reading the store in another language: the request names a published language (x-shopnex-language) and products, collections
// and pages come back with their translated text, field by field, and in the shop's own language where there is none.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { LANGUAGE_HEADER } from '@shopnex/storefront-sdk/constants'
import * as fx from './fixtures'

const { db, eq, sf, run, SHOP } = fx
const { languageService: languages } = await import('@shopnex/languages')
const { shopLanguages, translations } = await import('@shopnex/languages/schema')

const FR = { [LANGUAGE_HEADER]: 'fr' }
type Product = { id: string; handle: string; title: string; description: string; descriptionHtml: string }
type Collection = { id: string; title: string; description: string }
type PageOut = { id: string; title: string; body: string; bodySummary: string }
const page = { first: 20 }

const wipe = async () => {
  await db.delete(translations).where(eq(translations.shopId, SHOP))
  await db.delete(shopLanguages).where(eq(shopLanguages.shopId, SHOP))
}
before(fx.setup)
beforeEach(async () => {
  await fx.cleanup()
  await wipe()
  await languages.publish(SHOP, 'fr', db)
})
after(async () => {
  await fx.cleanup()
  await wipe()
})

const translate = (resource: 'product' | 'collection' | 'page', id: string, field: string, value: string) =>
  languages.translate(SHOP, { resource, resourceId: id, language: 'fr', field, value, source: 'source' }, db)

describe('the shop', () => {
  test('lists the languages it publishes besides its own', async () => {
    await languages.publish(SHOP, 'de', db)
    const shop = await run<{ languageCode: string; languages: string[] }>(sf.shop!.get)
    assert.deepEqual([shop.languageCode, shop.languages], ['en', ['de', 'fr']])
  })
})

describe('products', () => {
  test('come back translated for a published language, in every way a product is read', async () => {
    const p = await fx.product({ title: 'Red shirt', description: 'Soft cotton' })
    await translate('product', p.id, 'title', 'Chemise rouge')
    await translate('product', p.id, 'description', '<p>Coton <b>doux</b></p>')

    const byId = await run<Product>(sf.products!.get, { id: p.id }, FR)
    const byHandle = await run<Product>(sf.products!.getByHandle, { handle: p.slug }, FR)
    const listed = (await run<{ nodes: Product[] }>(sf.products!.list, page, FR)).nodes.find((n) => n.id === p.id)
    for (const read of [byId, byHandle, listed!]) {
      assert.equal(read.title, 'Chemise rouge')
      assert.equal(read.description, 'Coton doux')
      assert.equal(read.descriptionHtml, '<p>Coton <b>doux</b></p>')
    }
  })

  test('are unchanged without the header, for the shop’s own language, an unpublished one or a junk one', async () => {
    const p = await fx.product({ title: 'Red shirt', description: 'Soft cotton' })
    await translate('product', p.id, 'title', 'Chemise rouge')
    const cases: Record<string, string>[] = [
      {},
      { [LANGUAGE_HEADER]: 'en' },
      { [LANGUAGE_HEADER]: 'de' },
      { [LANGUAGE_HEADER]: '!!' },
    ]
    for (const headers of cases) {
      const read = await run<Product>(sf.products!.get, { id: p.id }, headers)
      assert.equal(read.title, 'Red shirt', JSON.stringify(headers))
    }
  })

  test('keep the original text of a field with no translation, and sanitize a translated description', async () => {
    const p = await fx.product({ title: 'Red shirt', description: 'Soft cotton' })
    await translate('product', p.id, 'description', '<p>Coton</p><script>alert(1)</script>')
    const read = await run<Product>(sf.products!.get, { id: p.id }, FR)
    assert.equal(read.title, 'Red shirt', 'no title translation: the original title')
    assert.equal(read.description, 'Coton')
    assert.ok(!read.descriptionHtml.includes('<script'), read.descriptionHtml)
  })

  test('unpublishing the language hides its translations; publishing it brings them back', async () => {
    const p = await fx.product({ title: 'Red shirt' })
    await translate('product', p.id, 'title', 'Chemise rouge')
    await languages.unpublish(SHOP, 'fr', db)
    assert.equal((await run<Product>(sf.products!.get, { id: p.id }, FR)).title, 'Red shirt')
    await languages.publish(SHOP, 'fr', db)
    assert.equal((await run<Product>(sf.products!.get, { id: p.id }, FR)).title, 'Chemise rouge')
  })

  test('deleting a product deletes its translations', async () => {
    const p = await fx.product({ title: 'Red shirt' })
    await translate('product', p.id, 'title', 'Chemise rouge')
    assert.equal(await languages.countFor(SHOP, db), 1)
    await fx.productService.removeMany(SHOP, [p.id], db)
    assert.equal(await languages.countFor(SHOP, db), 0)
  })
})

describe('collections', () => {
  test('come back translated, listed or by handle; deleting one deletes its translations', async () => {
    const c = await fx.collectionService.create(SHOP, { title: 'Summer', description: 'Sun' }, db)
    await translate('collection', c.id, 'title', 'Été')
    await translate('collection', c.id, 'description', '<p>Soleil</p>')
    const listed = (await run<{ nodes: Collection[] }>(sf.collections!.list, page, FR)).nodes.find((n) => n.id === c.id)
    const one = await run<Collection>(sf.collections!.getByHandle, { handle: c.slug }, FR)
    for (const read of [listed!, one]) assert.deepEqual([read.title, read.description], ['Été', 'Soleil'])
    assert.equal((await run<Collection>(sf.collections!.getByHandle, { handle: c.slug })).title, 'Summer')
    await fx.collectionService.remove(SHOP, c.id, db)
    assert.equal(await languages.countFor(SHOP, db), 0)
  })
})

describe('pages', () => {
  test('come back translated with a summary of the translated text; deleting one deletes its translations', async () => {
    const p = await fx.pageService.create(SHOP, { handle: 'about', title: 'About', bodyHtml: '<p>About us</p>' }, db)
    await translate('page', p.id, 'title', 'À propos')
    await translate('page', p.id, 'body', '<p>À propos de nous</p><script>x()</script>')
    const one = await run<PageOut>(sf.pages!.getByHandle, { handle: 'about' }, FR)
    assert.deepEqual(
      [one.title, one.body, one.bodySummary],
      ['À propos', '<p>À propos de nous</p>', 'À propos de nous'],
    )
    const listed = (await run<{ nodes: PageOut[] }>(sf.pages!.list, page, FR)).nodes.find((n) => n.id === p.id)
    assert.equal(listed?.title, 'À propos')
    assert.equal((await run<PageOut>(sf.pages!.getByHandle, { handle: 'about' })).title, 'About')
    await fx.pageService.remove(SHOP, p.id, db)
    assert.equal(await languages.countFor(SHOP, db), 0)
  })
})
