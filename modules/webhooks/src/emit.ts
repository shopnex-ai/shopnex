import { and, arrayContains, eq } from 'drizzle-orm'
import { schema, type Conn } from '@shopnex/db'
import type { WebhookTopic } from '@shopnex/db/schema'

export function envelope(shopId: string, topic: string, data: unknown) {
  return JSON.stringify({ type: topic, timestamp: new Date().toISOString(), shopId, data })
}

/**
 * Queues `topic` for every active endpoint of the shop subscribed to it. Pass the transaction that made
 * the change: deliveries are only sent if it commits (outbox), and the payload sees its writes.
 * `payload` only runs when someone is subscribed, so shops without webhooks pay one indexed query.
 */
export async function emit(conn: Conn, shopId: string, topic: WebhookTopic, payload: () => unknown) {
  const endpoints = await conn
    .select({ id: schema.webhookEndpoints.id })
    .from(schema.webhookEndpoints)
    .where(
      and(
        eq(schema.webhookEndpoints.shopId, shopId),
        eq(schema.webhookEndpoints.active, true),
        arrayContains(schema.webhookEndpoints.topics, [topic]),
      ),
    )
  if (endpoints.length === 0) return
  const body = envelope(shopId, topic, await payload())
  await conn.insert(schema.webhookDeliveries).values(endpoints.map((e) => ({ shopId, endpointId: e.id, topic, body })))
}
