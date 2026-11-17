// Admin: Settings → Webhooks. Business logic only; every query is scoped by shopId.
// `tokenId` (an API token calling): only the endpoints that token created. Omitted for staff, who see all.
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { all, schema, type Conn } from '@shopnex/db'
import { WEBHOOK_TEST_TOPIC, type WebhookTopic } from '@shopnex/db/schema'
import { envelope } from './emit'
import { only } from './rows'
import { generateSecret } from './sign'

export interface EndpointInput {
  url: string
  description?: string | null
  topics: WebhookTopic[]
  active?: boolean
}

const owned = (shopId: string, tokenId?: string) =>
  and(eq(schema.webhookEndpoints.shopId, shopId), tokenId ? eq(schema.webhookEndpoints.apiTokenId, tokenId) : undefined)
const byShop = (shopId: string, id: string, tokenId?: string) =>
  and(owned(shopId, tokenId), eq(schema.webhookEndpoints.id, id))

// With the name of the API token (or app) that created each endpoint (null: added in the admin)
export async function list(shopId: string, tokenId: string | undefined, conn: Conn) {
  const rows = await conn
    .select({
      endpoint: schema.webhookEndpoints,
      apiTokenName: schema.apiTokens.name,
      createdByApp: sql<boolean>`${schema.apiTokens.appId} is not null`,
    })
    .from(schema.webhookEndpoints)
    .leftJoin(schema.apiTokens, eq(schema.apiTokens.id, schema.webhookEndpoints.apiTokenId))
    .where(owned(shopId, tokenId))
    .orderBy(desc(schema.webhookEndpoints.createdAt))
  return rows.map((r) => ({ ...r.endpoint, apiTokenName: r.apiTokenName, createdByApp: r.createdByApp }))
}

export async function create(shopId: string, input: EndpointInput, tokenId: string | undefined, conn: Conn) {
  return only(
    await conn
      .insert(schema.webhookEndpoints)
      .values({ ...input, shopId, apiTokenId: tokenId ?? null, secret: generateSecret() })
      .returning(),
  )
}

export async function get(shopId: string, id: string, tokenId: string | undefined, conn: Conn) {
  const [endpoint] = await conn
    .select()
    .from(schema.webhookEndpoints)
    .where(byShop(shopId, id, tokenId))
  return endpoint ?? null
}

// Returns null when the endpoint isn't in this shop
export async function update(
  shopId: string,
  id: string,
  patch: Partial<EndpointInput>,
  tokenId: string | undefined,
  conn: Conn,
) {
  const [endpoint] = await conn
    .update(schema.webhookEndpoints)
    .set({ ...patch, updatedAt: new Date() })
    .where(byShop(shopId, id, tokenId))
    .returning()
  return endpoint ?? null
}

// Pending deliveries go with it
export async function remove(shopId: string, id: string, tokenId: string | undefined, conn: Conn) {
  const [endpoint] = await conn
    .delete(schema.webhookEndpoints)
    .where(byShop(shopId, id, tokenId))
    .returning()
  return endpoint ?? null
}

// The old secret stops working immediately (deliveries in flight are signed with the new one)
export async function rotateSecret(shopId: string, id: string, tokenId: string | undefined, conn: Conn) {
  const [endpoint] = await conn
    .update(schema.webhookEndpoints)
    .set({ secret: generateSecret(), updatedAt: new Date() })
    .where(byShop(shopId, id, tokenId))
    .returning()
  return endpoint ?? null
}

// Queues a `webhook.test` delivery to this endpoint only, whatever it's subscribed to
export async function sendTest(shopId: string, id: string, tokenId: string | undefined, conn: Conn) {
  const endpoint = await get(shopId, id, tokenId, conn)
  if (!endpoint) return null
  return only(
    await conn
      .insert(schema.webhookDeliveries)
      .values({
        shopId,
        endpointId: id,
        topic: WEBHOOK_TEST_TOPIC,
        body: envelope(shopId, WEBHOOK_TEST_TOPIC, { message: 'Test webhook from ShopNex', endpointId: id }),
      })
      .returning(),
  )
}

export interface ListDeliveriesInput {
  endpointId: string
  limit: number
  offset: number
}

// Null when the endpoint isn't visible to the caller
export async function listDeliveries(
  shopId: string,
  opts: ListDeliveriesInput,
  tokenId: string | undefined,
  conn: Conn,
) {
  if (!(await get(shopId, opts.endpointId, tokenId, conn))) return null
  const where = and(
    eq(schema.webhookDeliveries.shopId, shopId),
    eq(schema.webhookDeliveries.endpointId, opts.endpointId),
  )
  const [items, [total]] = await all(conn, [
    () =>
      conn
        .select()
        .from(schema.webhookDeliveries)
        .where(where)
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(opts.limit)
        .offset(opts.offset),
    () => conn.select({ total: count() }).from(schema.webhookDeliveries).where(where),
  ])
  return { items, total: total?.total ?? 0 }
}

// Sends the same delivery again (same webhook-id and body) on the next worker tick
export async function redeliver(shopId: string, deliveryId: string, tokenId: string | undefined, conn: Conn) {
  const visible = conn
    .select({ id: schema.webhookEndpoints.id })
    .from(schema.webhookEndpoints)
    .where(owned(shopId, tokenId))
  const [delivery] = await conn
    .update(schema.webhookDeliveries)
    .set({ status: 'pending', nextAttemptAt: sql`now()` })
    .where(
      and(
        eq(schema.webhookDeliveries.shopId, shopId),
        eq(schema.webhookDeliveries.id, deliveryId),
        inArray(schema.webhookDeliveries.endpointId, visible),
      ),
    )
    .returning()
  return delivery ?? null
}
