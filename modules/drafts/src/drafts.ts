// Drafts for any entity (see the entity_drafts table): autosave patches a draft, publishing applies it to the
// entity in one transaction, and the entity itself is only touched then. Every query is scoped by shopId, but
// whether the entity exists (and is the shop's) is for the caller to check, since only it knows the table.
//
// Adding a draftable entity: pick a type string, validate keys and values where the patch comes in (the
// router), merge the draft over the live data when it's previewed (`applyChanges`), and pass `publish` a
// function that writes the changes to the entity. Delete its drafts with it (`remove`).
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { DraftChanges } from '@shopnex/db/schema'

const t = schema.entityDrafts

const byEntity = (shopId: string, type: string, id: string) =>
  and(eq(t.shopId, shopId), eq(t.entityType, type), eq(t.entityId, id))

/** The draft was changed (or published) after the one the client saw */
export class DraftConflictError extends Error {
  constructor(readonly rev: number) {
    super('This was changed somewhere else. Reload to see the latest.')
  }
}

/** A draft over its live data: a key set to null is removed */
export function applyChanges<T>(live: Record<string, T>, changes: DraftChanges): Record<string, T> {
  const merged = { ...live }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete merged[key]
    else merged[key] = value as T
  }
  return merged
}

/** The entity's draft; empty (rev 0) when it has none */
export async function get(shopId: string, type: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select({ changes: t.changes, rev: t.rev })
    .from(t)
    .where(byEntity(shopId, type, id))
  return row ?? { changes: {} as DraftChanges, rev: 0 }
}

/** Merges `changes` into the draft, key by key, so concurrent saves of different keys don't overwrite each other */
export async function patch(shopId: string, type: string, id: string, changes: DraftChanges, conn: Conn = db) {
  const [row] = await conn
    .insert(t)
    .values({ shopId, entityType: type, entityId: id, changes, rev: 1 })
    .onConflictDoUpdate({
      target: [t.shopId, t.entityType, t.entityId],
      set: { changes: sql`${t.changes} || excluded.changes`, rev: sql`${t.rev} + 1`, updatedAt: new Date() },
    })
    .returning({ rev: t.rev })
  return row!.rev
}

/** Throws the draft away. Returns its new rev. */
export async function discard(shopId: string, type: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .update(t)
    .set({ changes: {}, rev: sql`${t.rev} + 1`, updatedAt: new Date() })
    .where(byEntity(shopId, type, id))
    .returning({ rev: t.rev })
  return row?.rev ?? 0
}

/**
 * Applies the draft with `apply` and clears it, in one transaction (a failing `apply` keeps the draft).
 * `expectedRev`: the rev the client last saw; a different one throws DraftConflictError, so a stale tab can't
 * publish changes it hasn't seen. `published` is false, and `apply` not called, when there is nothing to publish.
 */
export async function publish<T>(
  shopId: string,
  type: string,
  id: string,
  apply: (tx: Conn, changes: DraftChanges) => Promise<T>,
  options: { expectedRev?: number } = {},
  conn: Conn = db,
) {
  return conn.transaction(async (tx) => {
    const [row] = await tx.select().from(t).where(byEntity(shopId, type, id)).for('update')
    if (!row) return { published: false as const, rev: 0 }
    if (options.expectedRev !== undefined && options.expectedRev !== row.rev) throw new DraftConflictError(row.rev)
    if (!Object.keys(row.changes).length) return { published: false as const, rev: row.rev }
    const value = await apply(tx, row.changes)
    const [cleared] = await tx
      .update(t)
      .set({ changes: {}, rev: sql`${t.rev} + 1`, updatedAt: new Date() })
      .where(byEntity(shopId, type, id))
      .returning({ rev: t.rev })
    return { published: true as const, rev: cleared!.rev, value }
  })
}

/** Gives another entity (a duplicate) the same draft */
export async function copy(shopId: string, type: string, fromId: string, toId: string, conn: Conn = db) {
  const { changes } = await get(shopId, type, fromId, conn)
  if (Object.keys(changes).length) await patch(shopId, type, toId, changes, conn)
}

/** For when the entity is deleted */
export async function remove(shopId: string, type: string, id: string, conn: Conn = db) {
  await conn.delete(t).where(byEntity(shopId, type, id))
}

/**
 * For lists: left join the drafts of one entity type onto the entity's query
 * (`.leftJoin(schema.entityDrafts, draftJoin(type, row.shopId, row.id))`), then select `hasDraft`.
 */
export const draftJoin = (type: string, shopId: AnyColumn | SQL, id: AnyColumn | SQL) =>
  and(eq(t.shopId, shopId), eq(t.entityType, type), eq(t.entityId, sql`${id}::text`))

export const hasDraft = sql<boolean>`coalesce(${t.changes} <> '{}'::jsonb, false)`
