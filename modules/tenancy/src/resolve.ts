import type { Shop } from '@shopnex/db/schema'
import { isMultiTenant } from './config'
import { getShopByStorefrontKey } from './keys'
import {
  ensureDefaultShop,
  getFirstMembership,
  getFirstShop,
  getMembership,
  getShopByDomain,
  getShopById,
} from './shops'

export type ShopRole = 'owner' | 'admin' | 'member'

// superAdmin: platform super admin acting in this shop (may not be a member; acts as owner)
export type AdminTenant = { shop: Shop; role: ShopRole; superAdmin: boolean }

// x-forwarded-host is client-controllable unless a trusted proxy sets it; fine for public
// storefront reads, but never use it for admin authorization.
function hostOf(headers: Headers) {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? ''
  return host.split(':')[0]!.toLowerCase()
}

export const PUBLISHABLE_KEY_HEADER = 'x-shopnex-key'

export type StorefrontResolution = { ok: true; shop: Shop } | { ok: false; reason: 'invalid_key' | 'shop_not_found' }

// Storefront, in order:
//   1. x-shopnex-key header → that key's shop (external storefronts; an invalid key is an error, never a fallback)
//   2. single mode → default shop
//   3. multi mode  → shop mapped to the request host
export async function resolveStorefrontShop(headers: Headers): Promise<StorefrontResolution> {
  const key = headers.get(PUBLISHABLE_KEY_HEADER)
  if (key) {
    const shop = await getShopByStorefrontKey(key)
    return shop ? { ok: true, shop } : { ok: false, reason: 'invalid_key' }
  }
  if (!isMultiTenant) return { ok: true, shop: await ensureDefaultShop() }
  const shop = await getShopByDomain(hostOf(headers))
  return shop ? { ok: true, shop } : { ok: false, reason: 'shop_not_found' }
}

// Admin: single → default shop; multi → session's active shop, else the user's first shop.
// Super admins can act in any shop (falling back to the oldest shop) without membership.
// Returns null when the user isn't a member of that shop.
export async function resolveAdminShop(input: {
  userId: string
  activeShopId?: string | null
  superAdmin?: boolean
}): Promise<AdminTenant | null> {
  let shop: Shop | null
  if (!isMultiTenant) {
    shop = await ensureDefaultShop()
  } else {
    const shopId = input.activeShopId ?? (await getFirstMembership(input.userId))?.organizationId
    shop = shopId ? await getShopById(shopId) : input.superAdmin ? await getFirstShop() : null
  }
  if (!shop) return null

  if (input.superAdmin) return { shop, role: 'owner', superAdmin: true }

  const member = await getMembership(shop.id, input.userId)
  return member ? { shop, role: member.role as ShopRole, superAdmin: false } : null
}
