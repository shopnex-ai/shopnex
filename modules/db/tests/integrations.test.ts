// The shop integration helpers on a real in-memory database (PGlite): the secret stays sealed, and a save
// without a new key keeps the old one.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database and the encryption key when it is first imported
process.env.SHOPNEX_SECRET = 'test-secret'
process.env.DATABASE_URL = 'pglite:memory'

const { db, prepareDatabase, schema } = await import('../src/index')
const { deleteIntegration, getIntegration, integrationConfig, integrationSecret, saveIntegration } =
  await import('../src/integrations')

const SHOP = 'shop_test'
const PROVIDER = 'paystack' as const

before(async () => {
  await prepareDatabase()
  await db.insert(schema.shops).values({ id: SHOP, name: 'Test', slug: `test-${Date.now()}` })
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('saveIntegration then getIntegration', () => {
  test('returns the config, never the secret', async () => {
    await deleteIntegration(SHOP, PROVIDER)
    await saveIntegration(SHOP, PROVIDER, { secret: 'sk_test_123', config: { currency: 'ZAR', sandbox: true } })

    const row = await getIntegration(SHOP, PROVIDER)
    assert.ok(row)
    assert.equal(row.provider, PROVIDER)
    assert.deepEqual(row.config, { currency: 'ZAR', sandbox: true })
    assert.equal(row.enabled, true)
    assert.equal('secret' in row, false)
  })
})

describe('saveIntegration without a secret', () => {
  test('keeps the saved key, also when it is empty', async () => {
    await deleteIntegration(SHOP, PROVIDER)
    await saveIntegration(SHOP, PROVIDER, { secret: 'sk_original', config: { currency: 'ZAR' } })
    assert.equal(await integrationSecret(SHOP, PROVIDER), 'sk_original')

    await saveIntegration(SHOP, PROVIDER, { config: { currency: 'NGN' } })
    assert.equal(await integrationSecret(SHOP, PROVIDER), 'sk_original')

    await saveIntegration(SHOP, PROVIDER, { secret: '' })
    assert.equal(await integrationSecret(SHOP, PROVIDER), 'sk_original')
    assert.deepEqual((await getIntegration(SHOP, PROVIDER))?.config, { currency: 'NGN' })
  })
})

describe('integrationSecret when the integration is disabled', () => {
  test('returns null, so a switched-off provider is never called', async () => {
    await deleteIntegration(SHOP, PROVIDER)
    await saveIntegration(SHOP, PROVIDER, { secret: 'sk_live_123' })
    assert.equal(await integrationSecret(SHOP, PROVIDER), 'sk_live_123')

    await saveIntegration(SHOP, PROVIDER, { enabled: false })
    assert.equal(await integrationSecret(SHOP, PROVIDER), null)
    assert.equal((await getIntegration(SHOP, PROVIDER))?.enabled, false)
  })
})

describe('deleteIntegration', () => {
  test('removes the row, and a second delete is a no-op', async () => {
    await deleteIntegration(SHOP, PROVIDER)
    await saveIntegration(SHOP, PROVIDER, { secret: 'sk_delete_me' })
    assert.ok(await getIntegration(SHOP, PROVIDER))

    await deleteIntegration(SHOP, PROVIDER)
    assert.equal(await getIntegration(SHOP, PROVIDER), null)
    assert.equal(await integrationSecret(SHOP, PROVIDER), null)
    await deleteIntegration(SHOP, PROVIDER)
  })
})

describe('integrationConfig', () => {
  test('returns null after the row is deleted', async () => {
    await deleteIntegration(SHOP, PROVIDER)
    await saveIntegration(SHOP, PROVIDER, { secret: 'sk_config', config: { collectionAddress: '1 Main St' } })
    assert.deepEqual(await integrationConfig<{ collectionAddress: string }>(SHOP, PROVIDER), {
      collectionAddress: '1 Main St',
    })

    await deleteIntegration(SHOP, PROVIDER)
    assert.equal(await integrationConfig<{ collectionAddress: string }>(SHOP, PROVIDER), null)
  })
})
