// What the app sends CJ to list a product on TikTok: prices, sales options, attributes and the US-store rules.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { CategoryAttribute, CjShop, ProductDetails } from '@shopnex/cj-sdk'
import {
  askedAttributes,
  buildPublish,
  listingTitle,
  missingCertifications,
  optionsByVariant,
  priceWithMarkup,
  readAttributes,
} from '../src/tiktok'

const store = (type = 'tiktok') => ({ id: 'shop-1', name: 'My TikTok', type, status: 1, countryCode: 'GB' }) as CjShop

const variant = (vid: string, price: number) => ({
  vid,
  pid: 'p1',
  variantSku: `SKU-${vid}`,
  variantNameEn: vid,
  variantSellPrice: price,
  variantWeight: 250,
  variantLength: 300,
  variantWidth: 200,
  variantHeight: 20,
  variantImage: `https://img/${vid}.jpg`,
})

const details = (variants = [variant('v1', 10), variant('v2', 12.5)]) =>
  ({
    pid: 'p1',
    productNameEn: '  Casual   Loose\nShirt Dress ',
    productName: ['裙子'],
    productSku: 'CJ-1',
    productImage: JSON.stringify(['https://img/a.jpg', 'https://img/b.jpg', 'not a url']),
    description: '<p>Soft</p>',
    sellPrice: 9,
    variants,
  }) as unknown as ProductDetails

// Category attributes: two sales options (matched per variant by CJ) and two ordinary ones
const attributes: CategoryAttribute[] = [
  {
    id: 'color',
    name: 'Color',
    type: 'singleSelect',
    isRequired: true,
    variationSpecifics: true,
    isCanMountPictures: true,
    variantSpecificsVOS: [
      { vid: 'v1', optionName: 'Color', optionNameId: '100', optionValue: 'Red', optionValueId: '1' },
      { vid: 'v2', optionName: 'Color', optionNameId: '100', optionValue: 'Blue' },
    ],
  },
  {
    id: 'dept',
    name: 'Department',
    label: 'Department',
    type: 'singleSelect',
    isRequired: true,
    values: [
      { id: '7', value: 'Women' },
      { id: '8', value: 'Men' },
    ],
  },
  { id: 'material', name: 'Material', type: 'text', isRequired: true },
  { id: 'fit', name: 'Fit', type: 'text', isRequired: false },
]

describe('prices and titles', () => {
  test('markup is a percentage on CJ’s price, to the cent', () => {
    assert.equal(priceWithMarkup(10, 100), 20)
    assert.equal(priceWithMarkup(4.7, 100), 9.4)
    assert.equal(priceWithMarkup(3.33, 50), 5)
    assert.equal(priceWithMarkup(0, 0), 0.01, 'TikTok needs a price above zero')
  })

  test('the title is one tidy line within TikTok’s length', () => {
    assert.equal(listingTitle('  Casual   Loose\nShirt Dress '), 'Casual Loose Shirt Dress')
    assert.equal(listingTitle('x'.repeat(300)).length, 188)
  })
})

describe('sales options and attributes', () => {
  test('options are grouped by CJ variant; a value TikTok has no id for is custom', () => {
    const byVid = optionsByVariant(attributes)
    assert.deepEqual(byVid.get('v1'), [
      { optionName: 'Color', optionValue: 'Red', optionNameId: '100', optionValueId: '1', customized: false },
    ])
    assert.equal(byVid.get('v2')?.[0]?.customized, true)
  })

  test('only required attributes that are not sales options are asked', () => {
    assert.deepEqual(
      askedAttributes(attributes).map((a) => a.id),
      ['dept', 'material'],
    )
  })

  test('answers become attributes: a listed value by id, free text as given', () => {
    assert.deepEqual(readAttributes(attributes, { attr_dept: '7', attr_material: ' Cotton ' }), [
      {
        platformAttributeId: 'dept',
        platformAttributeName: 'Department',
        attributeValueList: [{ platformAttributeValueId: '7', platformAttributeValue: 'Women' }],
      },
      {
        platformAttributeId: 'material',
        platformAttributeName: 'Material',
        attributeValueList: [{ platformAttributeValue: 'Cotton' }],
      },
    ])
  })

  test('a missing answer names the attribute; a value outside the list is refused', () => {
    assert.throws(() => readAttributes(attributes, { attr_dept: '7' }), /Material is required/)
    assert.throws(() => readAttributes(attributes, { attr_dept: '99', attr_material: 'x' }), /Department/)
  })
})

describe('buildPublish', () => {
  const input = (over: Partial<Parameters<typeof buildPublish>[0]> = {}) => ({
    store: store(),
    details: details(),
    categoryId: 'cat-1',
    brandId: '',
    attributes,
    values: [],
    certifications: [],
    markupPercent: 100,
    ...over,
  })

  test('prices each variant with the markup and carries its options and size', () => {
    const p = buildPublish(input())
    assert.equal(p.shopId, 'shop-1')
    assert.equal(p.productId, 'p1')
    assert.equal(p.productTitle, 'Casual Loose Shirt Dress')
    assert.deepEqual(
      p.variants.map((v) => [v.variantId, v.price, v.sku, v.weight, v.length]),
      [
        ['v1', 20, 'SKU-v1', 250, 300],
        ['v2', 25, 'SKU-v2', 250, 300],
      ],
    )
    assert.equal(p.variants[0]?.options?.[0]?.optionNameId, '100')
    assert.equal(p.needUploadImgOptionName, 'Color', 'pictures go on the option TikTok lets carry them')
    assert.equal(p.categoryId, 'cat-1')
    assert.equal(p.platformBrandId, undefined, 'no brand chosen')
    assert.equal(p.targetCountryCode, 'GB')
  })

  test('only real image links, at most nine', () => {
    assert.deepEqual(buildPublish(input()).images, [{ url: 'https://img/a.jpg' }, { url: 'https://img/b.jpg' }])
  })

  test('US stores list from the US warehouse; the others do not say', () => {
    const us = buildPublish(input({ store: store('tiktok_us') }))
    assert.equal(us.defaultAreaId, '2')
    assert.equal(us.sourceCountryCode, 'US')
    assert.equal(buildPublish(input()).defaultAreaId, undefined)
  })

  test('certificates CJ has on file are sent, the others are reported', () => {
    const certifications = [
      { id: 'c1', name: 'CE', isBindCj: true, isApply: false },
      { id: 'c2', name: 'FCC', isBindCj: false, isApply: false },
    ]
    assert.deepEqual(buildPublish(input({ certifications })).productCertificationList, [
      { platformCertificationId: 'c1', platformCertificationName: 'CE' },
    ])
    assert.deepEqual(
      missingCertifications(certifications).map((c) => c.name),
      ['FCC'],
    )
  })

  test('several variants without matched options are refused, a single one is fine', () => {
    assert.throws(() => buildPublish(input({ attributes: [] })), /could not be matched/)
    const single = buildPublish(input({ attributes: [], details: details([variant('v1', 10)]) }))
    assert.equal(single.variants.length, 1)
    assert.equal(single.needUploadImgOptionName, undefined)
  })

  test('more variants than TikTok takes are refused', () => {
    const many = Array.from({ length: 101 }, (_, i) => variant(`v${i}`, 1))
    assert.throws(() => buildPublish(input({ details: details(many) })), /up to 100 variants/)
  })
})
