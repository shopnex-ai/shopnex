type Access = {
  session: { user: { id: string } } | null
  tenant: { shop: { id: string }; role?: string | null; superAdmin?: boolean } | null
}

/**
 * Who may open an embedded app, and as whom. The shop and user come from the request's own session, never from
 * the caller's input, so a direct call to the server function cannot pick another shop or staff member.
 */
export function embeddedAppAccess(access: Access) {
  const { tenant, session } = access
  if (!tenant || !session) return { status: 'none' as const }
  if (!tenant.superAdmin && tenant.role !== 'owner' && tenant.role !== 'admin') return { status: 'forbidden' as const }
  return { status: 'ok' as const, shopId: tenant.shop.id, userId: session.user.id }
}
