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

describe('catalog manifest', () => {
  test('tables lists every table the schema file exports (products and product_variants are still db’s)', async () => {
    const { is } = await import('drizzle-orm')
    const { PgTable } = await import('drizzle-orm/pg-core')
    const { catalogModule } = await import('../src/catalog.module')
    const schema = (await import('../src/catalog.schema')) as Record<string, unknown>
    const exported = new Set(Object.values(schema).filter((v) => is(v, PgTable)))
    assert.equal(exported.size, 6)
    assert.deepEqual(new Set(Object.values(catalogModule.tables)), exported)
  })

  test('the name is the folder, and the route groups are the ones it was mounted with', async () => {
    const { catalogModule } = await import('../src/catalog.module')
    assert.equal(catalogModule.name, 'catalog')
    assert.deepEqual(Object.keys(catalogModule.router).sort(), ['collections', 'products'])
  })
})
