// Sales channels (Shopify: Online Store, headless storefronts, later POS and the like). A channel is where a
// shop sells; what it shows comes from publications.ts. Every query is scoped by shopId.
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { Channel, ChannelType } from '@shopnex/db/schema'
import { ChannelError } from './errors'

const t = schema.channels

export const DEFAULT_HANDLE = schema.DEFAULT_CHANNEL_HANDLE

export type ChannelInput = { name: string; handle?: string; type?: ChannelType; autoPublish?: boolean }

// "Wholesale Portal!" → "wholesale-portal". Trims with a loop, not a regex: this runs on caller input.
function slugify(name: string) {
  const slug = name
    .slice(0, 200)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
  let start = 0
  let end = slug.length
  while (slug[start] === '-') start++
  while (end > start && slug[end - 1] === '-') end--
  return slug.slice(start, end) || 'channel'
}

/** The shop's channels, Online Store first */
export async function list(shopId: string, conn: Conn = db) {
  const rows = await conn.select().from(t).where(eq(t.shopId, shopId)).orderBy(asc(t.createdAt), asc(t.handle))
  return rows.sort((a, b) => Number(b.handle === DEFAULT_HANDLE) - Number(a.handle === DEFAULT_HANDLE))
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.id, id)))
  return row ?? null
}

/**
 * The Online Store channel. Shops are created in several places (the default shop, Better Auth organizations),
 * so it's created here on first use rather than at each of them; the migration made it for existing shops.
 */
export async function getDefault(shopId: string, conn: Conn = db): Promise<Channel> {
  const [existing] = await conn
    .select()
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.handle, DEFAULT_HANDLE)))
  if (existing) return existing
  await conn
    .insert(t)
    .values({ shopId, handle: DEFAULT_HANDLE, name: 'Online Store', type: 'online_store', autoPublish: true })
    .onConflictDoNothing()
  const [row] = await conn
    .select()
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.handle, DEFAULT_HANDLE)))
  return row!
}

/** The given channel, or the default one when none is given. Throws when it isn't the shop's. */
export async function resolve(shopId: string, id: string | undefined, conn: Conn = db) {
  if (!id) return getDefault(shopId, conn)
  const channel = await getById(shopId, id, conn)
  if (!channel) throw new ChannelError('CHANNEL_NOT_FOUND', 'Channel not found')
  return channel
}

export async function create(shopId: string, input: ChannelInput, conn: Conn = db) {
  const handle = input.handle ?? slugify(input.name)
  const [taken] = await conn
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.handle, handle)))
  if (taken || handle === DEFAULT_HANDLE) {
    throw new ChannelError('HANDLE_TAKEN', `Handle "${handle}" is already used by another channel`)
  }
  const [row] = await conn
    .insert(t)
    .values({
      shopId,
      handle,
      name: input.name,
      type: input.type ?? 'headless',
      autoPublish: input.autoPublish ?? false,
    })
    .returning()
  return row!
}

// The handle and type are fixed (storefronts and integrations may rely on them)
export async function update(
  shopId: string,
  id: string,
  patch: Partial<Pick<ChannelInput, 'name' | 'autoPublish'>>,
  conn: Conn = db,
) {
  if (!Object.keys(patch).length) return getById(shopId, id, conn)
  const [row] = await conn
    .update(t)
    .set(patch)
    .where(and(eq(t.shopId, shopId), eq(t.id, id)))
    .returning()
  return row ?? null
}

/**
 * Not the Online Store, and not a channel that has orders or storefront keys in use. Revoked keys are deleted
 * with it (they can't be used anymore and nothing else removes them).
 */
export async function remove(shopId: string, id: string, conn: Conn = db) {
  const channel = await getById(shopId, id, conn)
  if (!channel) return null
  if (channel.handle === DEFAULT_HANDLE) {
    throw new ChannelError('CHANNEL_PROTECTED', 'The Online Store channel can’t be deleted')
  }
  const keys = schema.storefrontKeys
  const [[orders], [activeKeys]] = await Promise.all([
    conn.select({ n: count() }).from(schema.orders).where(eq(schema.orders.channelId, id)),
    conn
      .select({ n: count() })
      .from(keys)
      .where(and(eq(keys.channelId, id), isNull(keys.revokedAt))),
  ])
  if (orders!.n || activeKeys!.n) {
    throw new ChannelError(
      'CHANNEL_IN_USE',
      'This channel has orders or active storefront keys, so it can’t be deleted. Revoke its keys, or unpublish its products instead.',
    )
  }
  const run = async (tx: Conn) => {
    await tx.delete(keys).where(eq(keys.channelId, id))
    await tx.delete(t).where(and(eq(t.shopId, shopId), eq(t.id, id)))
  }
  if (conn === db) await db.transaction(run)
  else await run(conn)
  return channel
}
