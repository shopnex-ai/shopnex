// The manifest must say what the module really has: a name that is the folder, the one route group it was mounted with, and no tables (the
// shapes it answers with are @shopnex/storefront-sdk's, and the rows are other modules').
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { storefrontModule } = await import('../src/storefront.module')
const { storefrontContract } = await import('@shopnex/storefront-sdk/contract')

describe('storefront manifest', () => {
  test('the name is the folder, it has no tables, and it is mounted as one group', () => {
    assert.equal(storefrontModule.name, 'storefront')
    assert.equal('tables' in storefrontModule, false)
    assert.deepEqual(Object.keys(storefrontModule.router), ['storefront'])
  })

  test('it implements every procedure of the published contract, and nothing else', () => {
    const names = (router: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(router).flatMap(([key, value]) =>
        value && typeof value === 'object' && !('~orpc' in value) && !('~standard' in value)
          ? names(value as Record<string, unknown>, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      )
    assert.deepEqual(
      names(storefrontModule.router.storefront as unknown as Record<string, unknown>).sort(),
      names(storefrontContract as unknown as Record<string, unknown>).sort(),
    )
  })
})
