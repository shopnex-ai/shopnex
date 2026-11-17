import { and, arrayContains, eq } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { webhookDeliveries, webhookEndpoints, type WebhookTopic } from './webhooks.schema'

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
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.shopId, shopId),
        eq(webhookEndpoints.active, true),
        arrayContains(webhookEndpoints.topics, [topic]),
      ),
    )
  if (endpoints.length === 0) return
  const body = envelope(shopId, topic, await payload())
  await conn.insert(webhookDeliveries).values(endpoints.map((e) => ({ shopId, endpointId: e.id, topic, body })))
}
