import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { channelService } from '@shopnex/channels'
import { db, schema } from '@shopnex/db'

export const PUBLISHABLE_KEY_PREFIX = 'pk_'

/** `channelId`: the channel the key reads (default: the Online Store). Throws ChannelError when it isn't the shop's. */
export async function createStorefrontKey(shopId: string, name: string, channelId?: string) {
  const channel = await channelService.resolve(shopId, channelId)
  const [key] = await db
    .insert(schema.storefrontKeys)
    .values({
      id: randomUUID(),
      shopId,
      name,
      channelId: channel.id,
      token: PUBLISHABLE_KEY_PREFIX + randomBytes(24).toString('base64url'),
    })
    .returning()
  return key!
}

export async function listStorefrontKeys(shopId: string) {
  return db
    .select()
    .from(schema.storefrontKeys)
    .where(eq(schema.storefrontKeys.shopId, shopId))
    .orderBy(desc(schema.storefrontKeys.createdAt))
}

// Returns null when the key doesn't exist in this shop or is already revoked
export async function revokeStorefrontKey(shopId: string, id: string) {
  const [key] = await db
    .update(schema.storefrontKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.storefrontKeys.shopId, shopId),
        eq(schema.storefrontKeys.id, id),
        isNull(schema.storefrontKeys.revokedAt),
      ),
    )
    .returning()
  return key ?? null
}

/** The key's shop and the channel it reads */
export async function getShopByStorefrontKey(token: string) {
  const [row] = await db
    .select({ shop: schema.shops, channelId: schema.storefrontKeys.channelId })
    .from(schema.storefrontKeys)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.storefrontKeys.shopId))
    .where(and(eq(schema.storefrontKeys.token, token), isNull(schema.storefrontKeys.revokedAt)))
  return row ?? null
}
