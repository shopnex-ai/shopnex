// What each channel shows (resource_publications): a resource is on a channel when it's published there and
// the date has come. Products also need status "active" (checked by the catalog, which owns it).
// Whether the resource itself exists, and is the shop's, is for the caller to check: only it knows the table.
import { and, eq, exists, inArray, lte, sql, type AnyColumn } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { PublishableType } from '@shopnex/db/schema'
import { ChannelError } from './errors'

const t = schema.resourcePublications

export type Publication = { channelId: string; publishedAt: Date }

/** Publish on this date; a date in the future schedules it, omitted means now */
export type PublicationInput = { channelId: string; publishAt?: Date | null }

/**
 * For queries on the resource's table: true when the resource is on the channel
 * (`.where(publicationService.liveOn('product', channelId, schema.products.id))`).
 */
export const liveOn = (type: PublishableType, channelId: string, resourceId: AnyColumn) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(t)
      .where(
        and(
          eq(t.channelId, channelId),
          eq(t.resourceType, type),
          eq(t.resourceId, resourceId),
          lte(t.publishedAt, sql`now()`),
        ),
      ),
  )

/** Every channel the resource is published on, scheduled ones included */
export async function listFor(shopId: string, type: PublishableType, ids: string[], conn: Conn = db) {
  const byResource = new Map<string, Publication[]>(ids.map((id) => [id, []]))
  if (!ids.length) return byResource
  const rows = await conn
    .select()
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.resourceType, type), inArray(t.resourceId, ids)))
  for (const row of rows)
    byResource.get(row.resourceId)?.push({ channelId: row.channelId, publishedAt: row.publishedAt })
  return byResource
}

/** Which of the resources are on the channel now */
export async function liveIds(
  shopId: string,
  channelId: string,
  type: PublishableType,
  ids: string[],
  conn: Conn = db,
) {
  if (!ids.length) return new Set<string>()
  const rows = await conn
    .select({ id: t.resourceId })
    .from(t)
    .where(
      and(
        eq(t.shopId, shopId),
        eq(t.channelId, channelId),
        eq(t.resourceType, type),
        inArray(t.resourceId, ids),
        lte(t.publishedAt, sql`now()`),
      ),
    )
  return new Set(rows.map((r) => r.id))
}

export async function isLive(shopId: string, channelId: string, type: PublishableType, id: string, conn: Conn = db) {
  return (await liveIds(shopId, channelId, type, [id], conn)).has(id)
}

/**
 * Makes the resource published on exactly these channels. A channel that stays keeps its date, so saving the
 * same list again doesn't reset a schedule; one given a date changes to it.
 */
export async function set(
  shopId: string,
  type: PublishableType,
  id: string,
  items: PublicationInput[],
  conn: Conn = db,
) {
  const wanted = new Map(items.map((i) => [i.channelId, i]))
  const channelIds = [...wanted.keys()]
  if (channelIds.length) {
    const own = await conn
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(and(eq(schema.channels.shopId, shopId), inArray(schema.channels.id, channelIds)))
    if (own.length !== channelIds.length) throw new ChannelError('CHANNEL_NOT_FOUND', 'Channel not found')
  }
  const run = async (tx: Conn) => {
    const current = await tx
      .select()
      .from(t)
      .where(and(eq(t.shopId, shopId), eq(t.resourceType, type), eq(t.resourceId, id)))
    const stale = current.filter((p) => !wanted.has(p.channelId)).map((p) => p.channelId)
    if (stale.length) {
      await tx.delete(t).where(and(eq(t.resourceType, type), eq(t.resourceId, id), inArray(t.channelId, stale)))
    }
    for (const item of items) {
      const existing = current.find((p) => p.channelId === item.channelId)
      if (existing && !item.publishAt) continue
      await tx
        .insert(t)
        .values({
          shopId,
          channelId: item.channelId,
          resourceType: type,
          resourceId: id,
          publishedAt: item.publishAt ?? new Date(),
        })
        .onConflictDoUpdate({
          target: [t.channelId, t.resourceType, t.resourceId],
          set: { publishedAt: item.publishAt ?? new Date() },
        })
    }
  }
  if (conn === db) await db.transaction(run)
  else await run(conn)
}

/** For a newly created resource: publishes it on the channels that want new resources (the Online Store) */
export async function autoPublish(shopId: string, type: PublishableType, id: string, conn: Conn = db) {
  const auto = await conn
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.shopId, shopId), eq(schema.channels.autoPublish, true)))
  if (!auto.length) return
  await conn
    .insert(t)
    .values(auto.map((c) => ({ shopId, channelId: c.id, resourceType: type, resourceId: id })))
    .onConflictDoNothing()
}

/** For when the resources are deleted */
export async function removeFor(shopId: string, type: PublishableType, ids: string[], conn: Conn = db) {
  if (!ids.length) return
  await conn.delete(t).where(and(eq(t.shopId, shopId), eq(t.resourceType, type), inArray(t.resourceId, ids)))
}
