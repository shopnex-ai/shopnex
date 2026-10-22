import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'

export const PUBLISHABLE_KEY_PREFIX = 'pk_'

export async function createStorefrontKey(shopId: string, name: string) {
  const [key] = await db
    .insert(schema.storefrontKeys)
    .values({
      id: randomUUID(),
      shopId,
      name,
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

export async function getShopByStorefrontKey(token: string) {
  const [row] = await db
    .select({ shop: schema.shops })
    .from(schema.storefrontKeys)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.storefrontKeys.shopId))
    .where(and(eq(schema.storefrontKeys.token, token), isNull(schema.storefrontKeys.revokedAt)))
  return row?.shop ?? null
}
