// Options, values and variants: what is accepted and what is refused, that a variant keeps its id when its combination stays (orders
// and carts point at it), the price cache, SKUs, stock (reserve and give back) and the stock webhook.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { productOptions } from '../src/catalog.schema'

const { db, schema, eq, productService, variantService, CatalogError, SHOP, OTHER_SHOP } = fx
const { DEFAULT_VARIANT_TITLE } = await import('../src')
const { optionsKey } = await import('../src/variants')
const refused = (code: string) => (e: unknown) => e instanceof CatalogError && e.code === code
const invalid = refused('INVALID_VARIANTS')
const MISSING = '00000000-0000-4000-8000-000000000000'

const sizes = (values = ['S', 'M']) => [{ name: 'Size', values }]
const bySize = (priceCents: number, size: string, extra = {}) => ({ options: { Size: size }, priceCents, ...extra })

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('the identity of a combination', () => {
  test('optionsKey does not depend on the order of the options, and a product without options has the empty key', () => {
    assert.equal(optionsKey({ Size: 'S', Color: 'Red' }), optionsKey({ Color: 'Red', Size: 'S' }))
    assert.notEqual(optionsKey({ Size: 'S' }), optionsKey({ Size: 'M' }))
    assert.equal(optionsKey({}), '')
    assert.equal(DEFAULT_VARIANT_TITLE, 'Default Title')
  })
})

describe('what a set of options and variants must look like', () => {
  const create = (
    options: { name: string; values: string[] }[],
    variants: Parameters<typeof productService.create>[1]['variants'],
  ) => productService.create(SHOP, { title: 'V', options, variants })

  test('option names and values must be filled in, and not repeated', async () => {
    await assert.rejects(create([{ name: ' ', values: ['a'] }], [{ options: { ' ': 'a' }, priceCents: 1 }]), invalid)
    await assert.rejects(create([{ name: 'Size', values: [] }], [{ priceCents: 1 }]), invalid)
    await assert.rejects(create(sizes(['S', ' ']), [bySize(1, 'S')]), invalid)
    await assert.rejects(create(sizes(['S', 'S']), [bySize(1, 'S')]), invalid)
    await assert.rejects(
      create([...sizes(['S']), { name: 'size', values: ['x'] }], [bySize(1, 'S')]),
      invalid,
      'names differ only by case',
    )
  })

  test('a product needs at least one variant, and one without options has exactly one', async () => {
    const p = await productService.create(SHOP, { title: 'V', priceCents: 1 })
    await assert.rejects(productService.setVariants(SHOP, p.id, { options: [], variants: [] }), invalid)
    await assert.rejects(
      productService.setVariants(SHOP, p.id, { options: [], variants: [{ priceCents: 1 }, { priceCents: 2 }] }),
      invalid,
    )
    await assert.rejects(create([], [{ priceCents: 1 }, { priceCents: 2 }]), invalid)
    await assert.rejects(
      create([], []),
      invalid,
      'a new product with an empty list is refused here, not by the database',
    )
    assert.equal(await productService.count(SHOP, { search: 'V' }), 1, 'and leaves no product behind')
  })

  test('each variant picks exactly one value of every option, and one that exists', async () => {
    await assert.rejects(create(sizes(), [{ priceCents: 1 }]), invalid, 'none picked')
    await assert.rejects(
      create(sizes(), [{ options: { Size: 'S', Extra: 'x' }, priceCents: 1 }]),
      invalid,
      'one too many',
    )
    await assert.rejects(create(sizes(), [{ options: { Color: 'S' }, priceCents: 1 }]), invalid, 'the wrong option')
    await assert.rejects(create(sizes(), [bySize(1, 'XL')]), invalid, 'not a value of the option')
  })

  test('a combination or a SKU may appear once in the product', async () => {
    await assert.rejects(create(sizes(), [bySize(1, 'S'), bySize(2, 'S')]), invalid)
    await assert.rejects(create(sizes(), [bySize(1, 'S', { sku: 'A' }), bySize(2, 'M', { sku: 'A' })]), invalid)
    const ok = await create(sizes(), [bySize(1, 'S', { sku: '' }), bySize(2, 'M', { sku: ' ' })])
    assert.deepEqual(
      ok.variants.map((v) => v.sku),
      [null, null],
      'blank SKUs are no SKU, so they may repeat',
    )
  })

  test('values are trimmed; the variant title joins the picked values in option order', async () => {
    const p = await productService.create(SHOP, {
      title: 'Tee',
      options: [
        { name: ' Color ', values: [' Red '] },
        { name: 'Size', values: ['S'] },
      ],
      variants: [{ options: { Size: 'S', ' Color ': ' Red ' }, priceCents: 5 }],
    })
    assert.deepEqual(
      p.options.map((o) => [o.name, o.values]),
      [
        ['Color', ['Red']],
        ['Size', ['S']],
      ],
    )
    assert.equal(p.variants[0]!.title, 'Red / S')
    assert.deepEqual(p.variants[0]!.options, { Color: 'Red', Size: 'S' })
    assert.deepEqual(p.variants[0]!.selectedOptions, [
      { name: 'Color', value: 'Red' },
      { name: 'Size', value: 'S' },
    ])
  })

  test('compare-at price, stock and image are kept; stock not tracked means available', async () => {
    const p = await create(sizes(['S', 'M', 'L']), [
      bySize(100, 'S', { compareAtPriceCents: 150, inventoryQuantity: 4, imageUrl: 'https://e.test/s.png' }),
      bySize(100, 'M', { inventoryQuantity: 0 }),
      bySize(100, 'L'),
    ])
    const [s, m, l] = p.variants
    assert.deepEqual(
      [s!.compareAtPriceCents, s!.inventoryQuantity, s!.imageUrl, s!.available],
      [150, 4, 'https://e.test/s.png', true],
    )
    assert.deepEqual([m!.inventoryQuantity, m!.available], [0, false])
    assert.deepEqual([l!.inventoryQuantity, l!.available, l!.compareAtPriceCents], [null, true, null])
  })
})

describe('replacing the variants of a product', () => {
  const tee = () =>
    productService.create(SHOP, {
      title: 'Tee',
      options: sizes(),
      variants: [bySize(1000, 'S', { sku: 'TEE-S' }), bySize(2000, 'M', { sku: 'TEE-M' })],
    })

  test('a variant whose combination stays keeps its id; new ones are added and gone ones deleted', async () => {
    const before = await tee()
    const [s, m] = before.variants
    const after = await productService.setVariants(SHOP, before.id, {
      options: sizes(['S', 'L']),
      variants: [bySize(1100, 'S', { sku: 'TEE-S' }), bySize(3000, 'L')],
    })
    assert.equal(after!.variants.find((v) => v.title === 'S')!.id, s!.id, 'S keeps its id')
    assert.equal(after!.variants.find((v) => v.title === 'S')!.priceCents, 1100, 'and takes the new price')
    assert.equal(
      after!.variants.some((v) => v.id === m!.id),
      false,
      'M is gone',
    )
    assert.deepEqual(after!.options[0]!.values, ['S', 'L'])
    assert.equal(
      (await db.select().from(schema.productVariants).where(eq(schema.productVariants.productId, before.id))).length,
      2,
    )
  })

  test('dropping an option removes its values and the links, and the variants re-key to the combination that is left', async () => {
    const p = await productService.create(SHOP, {
      title: 'Two',
      options: [...sizes(['S']), { name: 'Color', values: ['Red'] }],
      variants: [{ options: { Size: 'S', Color: 'Red' }, priceCents: 5 }],
    })
    const next = await productService.setVariants(SHOP, p.id, { options: sizes(['S']), variants: [bySize(5, 'S')] })
    assert.deepEqual(
      next!.options.map((o) => o.name),
      ['Size'],
    )
    assert.equal(next!.variants.length, 1)
    assert.equal((await db.select().from(productOptions).where(eq(productOptions.productId, p.id))).length, 1)
  })

  test('turning a product with variants into a simple one leaves the default variant', async () => {
    const p = await tee()
    const next = await productService.setVariants(SHOP, p.id, { options: [], variants: [{ priceCents: 900 }] })
    assert.deepEqual(
      next!.variants.map((v) => [v.title, v.priceCents]),
      [[DEFAULT_VARIANT_TITLE, 900]],
    )
    assert.equal(next!.priceCents, 900)
  })

  test('the product price follows the lowest variant', async () => {
    const p = await tee()
    assert.equal(p.priceCents, 1000)
    const next = await productService.setVariants(SHOP, p.id, {
      options: sizes(),
      variants: [bySize(1500, 'S'), bySize(700, 'M')],
    })
    assert.equal(next!.priceCents, 700)
  })

  test('a SKU used by another product in the shop is refused, the product’s own SKU is fine, and another shop’s does not count', async () => {
    const p = await tee()
    await assert.rejects(
      productService.create(SHOP, { title: 'Clash', variants: [{ priceCents: 1, sku: 'TEE-S' }] }),
      refused('SKU_TAKEN'),
    )
    await productService.setVariants(SHOP, p.id, {
      options: sizes(),
      variants: [bySize(1, 'S', { sku: 'TEE-S' }), bySize(1, 'M')],
    })
    const theirs = await productService.create(OTHER_SHOP, { title: 'T', variants: [{ priceCents: 1, sku: 'TEE-S' }] })
    assert.equal(theirs.variants[0]!.sku, 'TEE-S')
  })

  test('invalid input leaves everything as it was; an unknown product or another shop’s gives null', async () => {
    const p = await tee()
    await assert.rejects(
      productService.setVariants(SHOP, p.id, { options: sizes(), variants: [bySize(1, 'XL')] }),
      invalid,
    )
    assert.deepEqual(
      (await productService.getById(SHOP, p.id)) && (await productService.withDetails([p]))[0]!.variants.length,
      2,
    )
    assert.equal(await productService.setVariants(SHOP, MISSING, { options: [], variants: [{ priceCents: 1 }] }), null)
    const theirs = await productService.create(OTHER_SHOP, { title: 'T', priceCents: 1 })
    assert.equal(
      await productService.setVariants(SHOP, theirs.id, { options: [], variants: [{ priceCents: 9 }] }),
      null,
    )
  })

  test('each option value says which variant to land on: its first one, with the first value of every other option', async () => {
    const p = await productService.create(SHOP, {
      title: 'Grid',
      options: [
        { name: 'Color', values: ['Red', 'Blue'] },
        { name: 'Size', values: ['S', 'M'] },
      ],
      variants: [
        { options: { Color: 'Red', Size: 'S' }, priceCents: 1 },
        { options: { Color: 'Red', Size: 'M' }, priceCents: 1 },
        { options: { Color: 'Blue', Size: 'M' }, priceCents: 1 },
      ],
    })
    const title = (id: string | null) => p.variants.find((v) => v.id === id)?.title
    const [color, size] = p.options
    assert.deepEqual(
      color!.optionValues.map((v) => [v.name, title(v.firstSelectableVariantId)]),
      [
        ['Red', 'Red / S'],
        ['Blue', 'Blue / M'],
      ],
    )
    assert.deepEqual(
      size!.optionValues.map((v) => [v.name, title(v.firstSelectableVariantId)]),
      [
        ['S', 'Red / S'],
        ['M', 'Red / M'],
      ],
    )
  })
})

describe('changing one variant', () => {
  async function one() {
    const p = await productService.create(SHOP, {
      title: 'Tee',
      options: sizes(),
      variants: [bySize(1000, 'S', { sku: 'A' }), bySize(2000, 'M', { sku: 'B' })],
    })
    return { p, s: p.variants[0]!, m: p.variants[1]! }
  }

  test('price, SKU, compare-at price and stock can change; the product price follows', async () => {
    const { p, s } = await one()
    const u = await variantService.update(SHOP, s.id, {
      priceCents: 500,
      sku: ' NEW ',
      compareAtPriceCents: 900,
      inventoryQuantity: 7,
    })
    assert.deepEqual(
      [u?.priceCents, u?.sku, u?.compareAtPriceCents, u?.inventoryQuantity, u?.available],
      [500, 'NEW', 900, 7, true],
    )
    assert.equal((await productService.getById(SHOP, p.id))?.priceCents, 500)
  })

  test('a SKU of another variant in the shop is refused; the same SKU on the same variant, or a blank one, is fine', async () => {
    const { s } = await one()
    await assert.rejects(variantService.update(SHOP, s.id, { sku: 'B' }), refused('SKU_TAKEN'))
    assert.equal((await variantService.update(SHOP, s.id, { sku: 'A' }))?.sku, 'A')
    assert.equal((await variantService.update(SHOP, s.id, { sku: '  ' }))?.sku, null)
  })

  test('null for an unknown variant or another shop’s', async () => {
    const { s } = await one()
    assert.equal(await variantService.update(SHOP, MISSING, { priceCents: 1 }), null)
    assert.equal(await variantService.update(OTHER_SHOP, s.id, { priceCents: 1 }), null)
    assert.equal((await variantService.update(SHOP, s.id, {}))?.priceCents, 1000, 'an empty patch changes nothing')
  })

  test('stopping tracking stock makes the variant available again', async () => {
    const { s } = await one()
    await variantService.update(SHOP, s.id, { inventoryQuantity: 0 })
    const off = await variantService.update(SHOP, s.id, { inventoryQuantity: null })
    assert.deepEqual([off?.inventoryQuantity, off?.available], [null, true])
  })

  test('a change queues product.updated, and a change of stock inventory.updated with the new stock and the difference', async () => {
    const hook = await fx.endpoint(['product.updated', 'inventory.updated'])
    const { s } = await one()
    await variantService.update(SHOP, s.id, { priceCents: 1 })
    assert.deepEqual(
      (await fx.deliveries(hook.id)).map((d) => d.topic),
      ['product.updated'],
    )
    await variantService.update(SHOP, s.id, { inventoryQuantity: 10 })
    await variantService.update(SHOP, s.id, { inventoryQuantity: 6 })
    await variantService.update(SHOP, s.id, { inventoryQuantity: null })
    const stock = (await fx.deliveries(hook.id)).filter((d) => d.topic === 'inventory.updated').map((d) => d.data)
    assert.deepEqual(
      stock.map((d) => [d.inventoryQuantity, d.change, d.reason]),
      [
        [10, null, 'edit'],
        [6, -4, 'edit'],
        [null, null, 'edit'],
      ],
    )
    assert.deepEqual([stock[0]!.variantId, stock[0]!.sku], [s.id, 'A'])
  })
})

describe('stock for orders', () => {
  const stocked = async (quantity: number | null) => {
    const p = await productService.create(SHOP, {
      title: 'Stock',
      variants: [{ priceCents: 1, inventoryQuantity: quantity, sku: `K-${fx.unique()}` }],
    })
    return p.variants[0]!
  }
  const stockOf = async (id: string) =>
    (await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, id)))[0]!.inventoryQuantity

  test('reserveStock takes the quantity when there is enough and says so; not enough leaves it alone and says no', async () => {
    const v = await stocked(5)
    assert.equal(await variantService.reserveStock(SHOP, v.id, 3), true)
    assert.equal(await stockOf(v.id), 2)
    assert.equal(await variantService.reserveStock(SHOP, v.id, 3), false)
    assert.equal(await stockOf(v.id), 2)
    assert.equal(await variantService.reserveStock(SHOP, v.id, 2), true, 'down to exactly zero')
    assert.equal(await stockOf(v.id), 0)
  })

  test('two orders racing for the last unit: one gets it', async () => {
    const v = await stocked(1)
    const results = await Promise.all([
      variantService.reserveStock(SHOP, v.id, 1),
      variantService.reserveStock(SHOP, v.id, 1),
    ])
    assert.deepEqual(results.sort(), [false, true])
    assert.equal(await stockOf(v.id), 0)
  })

  test('a variant whose stock is not tracked always succeeds and stays null; an unknown or another shop’s variant does not', async () => {
    const v = await stocked(null)
    assert.equal(await variantService.reserveStock(SHOP, v.id, 99), true)
    assert.equal(await stockOf(v.id), null)
    assert.equal(await variantService.reserveStock(SHOP, MISSING, 1), false)
    assert.equal(await variantService.reserveStock(OTHER_SHOP, v.id, 1), false)
  })

  test('restock gives it back, and does nothing for an untracked variant or another shop’s', async () => {
    const v = await stocked(1)
    await variantService.reserveStock(SHOP, v.id, 1)
    await variantService.restock(SHOP, v.id, 1)
    assert.equal(await stockOf(v.id), 1)
    await variantService.restock(OTHER_SHOP, v.id, 5)
    assert.equal(await stockOf(v.id), 1)
    const free = await stocked(null)
    await variantService.restock(SHOP, free.id, 5)
    assert.equal(await stockOf(free.id), null)
  })

  test('reserving and giving back queue inventory.updated with the stock after it and the reason', async () => {
    const hook = await fx.endpoint(['inventory.updated'])
    const v = await stocked(4)
    await variantService.reserveStock(SHOP, v.id, 3)
    await variantService.reserveStock(SHOP, v.id, 9)
    await variantService.restock(SHOP, v.id, 2)
    const sent = (await fx.deliveries(hook.id))
      .map((d) => d.data)
      .sort((a, b) => (a.reason as string).localeCompare(b.reason as string))
    assert.deepEqual(
      sent.map((d) => [d.reason, d.inventoryQuantity, d.change]),
      [
        ['order', 1, -3],
        ['restock', 3, 2],
      ],
      'the refused reservation sent nothing',
    )
  })
})

describe('reading variants for orders', () => {
  test('getManyByIds and listForProducts give variants with their product’s title and vendor, scoped to the shop', async () => {
    const p = await productService.create(SHOP, {
      title: 'Tee',
      vendor: 'Acme',
      options: sizes(),
      variants: [bySize(1, 'S'), bySize(2, 'M', { imageUrl: 'https://e.test/m.png' })],
      images: [{ url: 'https://e.test/p.png' }],
    })
    const theirs = await productService.create(OTHER_SHOP, { title: 'Theirs', priceCents: 1 })
    const ids = [...p.variants.map((v) => v.id), theirs.variants[0]!.id]
    const rows = await variantService.getManyByIds(SHOP, ids)
    assert.equal(rows.length, 2)
    const bySizeTitle = Object.fromEntries(rows.map((r) => [r.variant.title, r]))
    assert.deepEqual(
      [bySizeTitle.S!.productTitle, bySizeTitle.S!.productVendor, bySizeTitle.S!.productStatus],
      ['Tee', 'Acme', 'active'],
    )
    assert.equal(bySizeTitle.S!.imageUrl, 'https://e.test/p.png', 'the product’s first image when the variant has none')
    assert.equal(bySizeTitle.M!.imageUrl, 'https://e.test/m.png', 'the variant’s own image first')
    assert.deepEqual(await variantService.getManyByIds(SHOP, []), [])
    assert.equal((await variantService.listForProducts(SHOP, [p.id, theirs.id])).length, 2)
    assert.deepEqual(await variantService.listForProducts(SHOP, []), [])
    assert.deepEqual(
      (await variantService.listByProduct(SHOP, p.id)).map((v) => v.title),
      ['S', 'M'],
    )
    assert.deepEqual(await variantService.listByProduct(SHOP, theirs.id), [])
  })

  test('with a channel, only variants of products live on it come back', async () => {
    const ch = await fx.channel()
    const on = await productService.create(SHOP, { title: 'On', priceCents: 1 })
    const off = await productService.create(SHOP, { title: 'Off', priceCents: 1 })
    await productService.setPublications(SHOP, on.id, [{ channelId: ch.id }])
    const rows = await variantService.getManyByIds(SHOP, [on.variants[0]!.id, off.variants[0]!.id], db, {
      channelId: ch.id,
    })
    assert.deepEqual(
      rows.map((r) => r.productTitle),
      ['On'],
    )
  })
})
