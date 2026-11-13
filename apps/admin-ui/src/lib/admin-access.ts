type Access<Shop extends { id: string }> = {
  session: { user: { id: string } } | null
  tenant: { shop: Shop; role?: string | null; superAdmin?: boolean } | null
}

/** Owner, admin or super admin: who manages the shop (apps, settings, staff). No tenant (no shop yet): no one. */
export const isShopManager = (tenant?: { role?: string | null; superAdmin?: boolean } | null) =>
  Boolean(tenant?.superAdmin) || tenant?.role === 'owner' || tenant?.role === 'admin'

/**
 * Who may use the admin as a shop manager (owner, admin or super admin), and as whom. The shop and user come from
 * the request's own session, never from a caller's input.
 */
export function managerAccess<Shop extends { id: string }>(access: Access<Shop>) {
  const { tenant, session } = access
  if (!tenant || !session) return { status: 'none' as const }
  if (!isShopManager(tenant)) return { status: 'forbidden' as const }
  return { status: 'ok' as const, shop: tenant.shop, shopId: tenant.shop.id, userId: session.user.id }
}
