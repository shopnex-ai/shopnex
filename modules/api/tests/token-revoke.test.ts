// Revoking an API token through the real route takes its webhook subscriptions with it. Staff-made and other tokens' subscriptions stay.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { call } from '@orpc/server'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { configureRpc } = await import('@shopnex/rpc')
const { router } = await import('../src/router')
const { webhookEndpoints, webhookDeliveries } = await import('@shopnex/webhooks/schema')
const { eq, inArray } = await import('drizzle-orm')

const SHOP = 'default'
const shop = { id: SHOP, storefrontUrl: null } as never
const admin = (router as unknown as { admin: Record<string, Record<string, unknown>> }).admin
const run = (procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, { context: { headers: new Headers() } } as never)

const tokenIds: string[] = []
const endpointIds: string[] = []
let counter = 0

async function token() {
  const [row] = await db
    .insert(schema.apiTokens)
    .values({
      shopId: SHOP,
      name: 'Hook test',
      scopes: [],
      tokenHash: `hook-${Date.now()}-${++counter}`,
      tokenPrefix: 'sk_hook',
    })
    .returning()
  tokenIds.push(row!.id)
  return row!
}
async function endpoint(apiTokenId: string | null) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({ shopId: SHOP, url: 'https://example.com/hook', topics: ['order.created'], secret: 'whsec_x', apiTokenId })
    .returning()
  endpointIds.push(row!.id)
  return row!
}
const exists = async (id: string) =>
  (await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.id, id))).length === 1

before(async () => {
  await prepareDatabase()
  configureRpc({
    session: () => Promise.resolve({ session: { activeOrganizationId: SHOP }, user: { id: 'u1' } } as never),
    adminShop: () => Promise.resolve({ shop, role: 'admin' as const, superAdmin: false }),
    token: () => Promise.resolve(null),
    hasScope: () => false,
  })
})

after(async () => {
  if (endpointIds.length) await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.id, endpointIds))
  if (tokenIds.length) await db.delete(schema.apiTokens).where(inArray(schema.apiTokens.id, tokenIds))
})

describe('revoking an API token, through the route', () => {
  test('removes the subscriptions the token made, with their deliveries, and only those', async () => {
    const gone = await token()
    const stays = await token()
    const mine = await endpoint(gone.id)
    const theirs = await endpoint(stays.id)
    const staffs = await endpoint(null)
    await db.insert(webhookDeliveries).values({ shopId: SHOP, endpointId: mine.id, topic: 'order.created', body: '{}' })

    await run(admin.apiTokens!.revoke, { id: gone.id })

    assert.equal(await exists(mine.id), false)
    assert.equal(await exists(theirs.id), true, 'another token’s subscription stays')
    assert.equal(await exists(staffs.id), true, 'a subscription staff made stays')
    const left = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, mine.id))
    assert.equal(left.length, 0)
    const [revoked] = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, gone.id))
    assert.ok(revoked?.revokedAt)
  })
})
