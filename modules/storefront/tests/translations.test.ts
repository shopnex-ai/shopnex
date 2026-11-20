// Reading the store in another language: the request names a published language (x-shopnex-language) and products, collections
// and pages come back with their translated text, field by field, and in the shop's own language where there is none.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { LANGUAGE_HEADER } from '@shopnex/storefront-sdk/constants'
import * as fx from './fixtures'

const { db, eq, sf, run, SHOP } = fx
const { languageService: languages } = await import('@shopnex/languages')
const { optionNameField, optionValueField, shopLanguages, translations } = await import('@shopnex/languages/schema')

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

describe('product options', () => {
  type Opt = { id: string; name: string; optionValues: { id: string; name: string }[] }
  type Variant = { id: string; title: string; selectedOptions: { name: string; value: string }[] }
  type WithOptions = { options: Opt[]; variants: Variant[] }

  async function shirt() {
    const p = await fx.product({
      title: 'Shirt',
      options: [
        { name: 'Color', values: ['Red', 'Blue'] },
        { name: 'Size', values: ['S', 'M'] },
      ],
      variants: [
        { options: { Color: 'Red', Size: 'S' }, priceCents: 1000 },
        { options: { Color: 'Blue', Size: 'M' }, priceCents: 1100 },
      ],
    })
    const base = await run<WithOptions>(sf.products!.get, { id: p.id })
    const color = base.options.find((o) => o.name === 'Color')!
    const size = base.options.find((o) => o.name === 'Size')!
    const red = color.optionValues.find((v) => v.name === 'Red')!
    return { p, base, color, size, red }
  }
  const translateField = (productId: string, field: string, value: string) =>
    languages.translate(
      SHOP,
      { resource: 'product', resourceId: productId, language: 'fr', field, value, source: 'src' },
      db,
    )

  test('translated names and values show in the options, and the variants are made of them', async () => {
    const { p, color, size, red } = await shirt()
    await translateField(p.id, optionNameField(color.id), 'Couleur')
    await translateField(p.id, optionValueField(red.id), 'Rouge')
    await translateField(p.id, optionNameField(size.id), 'Taille')
    const read = await run<WithOptions>(sf.products!.get, { id: p.id }, FR)

    const colorOption = read.options.find((o) => o.id === color.id)
    assert.deepEqual([colorOption?.name, colorOption?.optionValues.map((v) => v.name)], ['Couleur', ['Rouge', 'Blue']])
    assert.equal(read.options.find((o) => o.id === size.id)?.name, 'Taille')
    // Variants carry the same translated names and values, so a theme still finds the one a shopper picked
    assert.deepEqual(
      read.variants.map((v) => [v.title, v.selectedOptions]),
      [
        [
          'Rouge / S',
          [
            { name: 'Couleur', value: 'Rouge' },
            { name: 'Taille', value: 'S' },
          ],
        ],
        [
          'Blue / M',
          [
            { name: 'Couleur', value: 'Blue' },
            { name: 'Taille', value: 'M' },
          ],
        ],
      ],
    )
    for (const variant of read.variants) {
      for (const s of variant.selectedOptions) {
        const option = read.options.find((o) => o.name === s.name)
        assert.ok(
          option?.optionValues.some((v) => v.name === s.value),
          `${s.name}: ${s.value} is one of the page's options`,
        )
      }
    }
  })

  test('are unchanged without the header, and in a language they were not translated into', async () => {
    const { p, base, color, red } = await shirt()
    await translateField(p.id, optionNameField(color.id), 'Couleur')
    await translateField(p.id, optionValueField(red.id), 'Rouge')
    assert.deepEqual(await run<WithOptions>(sf.products!.get, { id: p.id }), base)
    await languages.publish(SHOP, 'de', db)
    assert.deepEqual(await run<WithOptions>(sf.products!.get, { id: p.id }, { [LANGUAGE_HEADER]: 'de' }), base)
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
