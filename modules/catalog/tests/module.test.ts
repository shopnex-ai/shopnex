// What the rest of the repo relies on in @shopnex/catalog: the public names and the error codes with their statuses.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const catalog = await import('../src')

describe('the public surface', () => {
  test('the services and helpers other modules use are exported', () => {
    assert.deepEqual(Object.keys(catalog).sort(), [
      'CatalogError',
      'DEFAULT_VARIANT_TITLE',
      'PRODUCT_STATUSES',
      'SLUG_PATTERN',
      'collectionService',
      'escapeHtml',
      'htmlToText',
      'productService',
      'sanitizeHtml',
      'seedSampleProducts',
      'slugify',
      'variantService',
    ])
  })

  test('the product statuses', () => {
    assert.deepEqual([...catalog.PRODUCT_STATUSES], ['draft', 'active', 'archived'])
  })

  test('the error carries its code and message (the API tests pin the status each code is answered with)', () => {
    const e = new catalog.CatalogError('SKU_TAKEN', 'taken')
    assert.deepEqual([e.code, e.message, e instanceof Error], ['SKU_TAKEN', 'taken', true])
  })
})
