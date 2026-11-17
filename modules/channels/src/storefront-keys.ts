// Publishable keys: identify a shop (and the channel it reads) for external storefronts, sent as x-shopnex-key. They are public
// (shipped in browser code): they select a shop, they don't grant extra access.
import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import * as channelService from './channels'
import { storefrontKeys } from './channels.schema'
import { shops } from '@shopnex/core/schema'

export const PUBLISHABLE_KEY_PREFIX = 'pk_'

/** `channelId`: the channel the key reads (default: the Online Store). Throws ChannelError when it isn't the shop's. */
export async function create(shopId: string, name: string, channelId: string | undefined, conn: Conn) {
  const channel = await channelService.resolve(shopId, channelId, conn)
  const [key] = await conn
    .insert(storefrontKeys)
    .values({
      id: randomUUID(),
      shopId,
      name,
      channelId: channel.id,
      token: PUBLISHABLE_KEY_PREFIX + randomBytes(24).toString('base64url'),
    })
    .returning()
  if (!key) throw new Error('The storefront key was not found after it was made')
  return key
}

export async function list(shopId: string, conn: Conn) {
  return conn
    .select()
    .from(storefrontKeys)
    .where(eq(storefrontKeys.shopId, shopId))
    .orderBy(desc(storefrontKeys.createdAt))
}

export async function revoke(shopId: string, id: string, conn: Conn) {
  const [key] = await conn
    .update(storefrontKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(storefrontKeys.shopId, shopId), eq(storefrontKeys.id, id), isNull(storefrontKeys.revokedAt)))
    .returning()
  return key ?? null
}

/** The key's shop and the channel it reads. Null for an unknown or revoked key. */
export async function shopByKey(token: string, conn: Conn) {
  const [row] = await conn
    .select({ shop: shops, channelId: storefrontKeys.channelId })
    .from(storefrontKeys)
    .innerJoin(shops, eq(shops.id, storefrontKeys.shopId))
    .where(and(eq(storefrontKeys.token, token), isNull(storefrontKeys.revokedAt)))
  return row ?? null
}
