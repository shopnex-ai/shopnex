// A domain error thrown by a service inside a real route answers with the status its class declares, with no mapper wired in the
// module or in modules/api: custom-fields, pricing and files, through the real router with fake resolvers and an in-memory database.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { configureRpc } = await import('@shopnex/rpc')
const { router } = await import('../src/router')
const { customFieldDefinitions } = await import('@shopnex/custom-fields/schema')
const { discounts, taxRates } = await import('@shopnex/pricing/schema')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const shop = { id: SHOP, storefrontUrl: null } as never
const admin = (router as unknown as { admin: Record<string, Record<string, unknown>> }).admin
const run = (procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, { context: { headers: new Headers() } } as never)
const refused = (code: string, domainCode: string) => (e: unknown) =>
  e instanceof ORPCError && e.code === code && (e.data as { code?: string } | undefined)?.code === domainCode

before(async () => {
  await prepareDatabase()
  // The routes are registered with the real resolvers when the router loads; these tests stand in as an admin of the shop
  configureRpc({
    session: () => Promise.resolve({ session: { activeOrganizationId: SHOP }, user: { id: 'u1' } } as never),
    adminShop: () => Promise.resolve({ shop, role: 'admin' as const, superAdmin: false }),
    token: () => Promise.resolve(null),
    hasScope: () => false,
  })
})

after(async () => {
  await db.delete(customFieldDefinitions).where(eq(customFieldDefinitions.shopId, SHOP))
  await db.delete(discounts).where(eq(discounts.shopId, SHOP))
  await db.delete(taxRates).where(eq(taxRates.shopId, SHOP))
})

describe('errors of the converted modules, through their routes', () => {
  test('custom-fields: a key that is taken is a 409 with its code', async () => {
    const field = { resource: 'product', key: 'material_errors', label: 'Material', type: 'text' }
    await run(admin.customFields!.create, field)
    await assert.rejects(run(admin.customFields!.create, field), refused('CONFLICT', 'KEY_TAKEN'))
  })

  test('pricing: a code another discount uses is a 409, and so is a region that already has a rate', async () => {
    const discount = { code: 'SAVE-ERRORS', type: 'percentage', value: 10 }
    await run(admin.discounts!.create, discount)
    await assert.rejects(run(admin.discounts!.create, discount), refused('CONFLICT', 'CODE_TAKEN'))
    const rate = { countryCode: 'DE', province: '', name: 'VAT', ratePercent: 19 }
    await run(admin.taxRates!.create, rate)
    await assert.rejects(run(admin.taxRates!.create, rate), refused('CONFLICT', 'TAX_RATE_EXISTS'))
  })

  test('files: something that is not an accepted image is a 400 with its code', async () => {
    const notAnImage = new File(['just some text'], 'notes.png', { type: 'image/png' })
    await assert.rejects(run(admin.files!.upload, { file: notAnImage }), refused('BAD_REQUEST', 'UNSUPPORTED_TYPE'))
  })
})
