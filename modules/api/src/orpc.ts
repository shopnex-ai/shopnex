import { configureRpc, createProcedures } from '@shopnex/rpc'
import { appService } from '@shopnex/apps'
import { auth, isSuperAdmin } from '@shopnex/auth'
import { hasScope } from '@shopnex/core/scopes'
import { resolveAdminShop, resolveApiToken } from '@shopnex/tenancy'

export { createContext, type Context } from '@shopnex/rpc'

// What rpc needs to recognise a request. Registered here, once, because api is the layer that knows about logins, API
// tokens and shops: rpc itself depends on none of them, so a module below auth or tenancy can have routes too.
declare module '@shopnex/rpc' {
  interface Register {
    session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
  }
}

configureRpc({
  session: (headers) => auth.api.getSession({ headers }),
  adminShop: ({ session, user }) =>
    resolveAdminShop({ userId: user.id, activeShopId: session.activeOrganizationId, superAdmin: isSuperAdmin(user) }),
  token: async (bearer) => (await resolveApiToken(bearer)) ?? (await appService.resolveAccessToken(bearer)),
  hasScope,
})

export const {
  pub,
  authed,
  admin,
  adminOrToken,
  scoped,
  paymentsApp,
  aiApp,
  carrierApp,
  shopManager,
  webhookManager,
  superAdminOnly,
} = createProcedures()
