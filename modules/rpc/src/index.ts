// The building blocks of a route: who is calling (staff, an API token, an app's token), the shop it acts on, and the
// scopes it needs. Every module that exposes routes builds its procedures from here, and `modules/api` does too.
// Nothing here knows a module: a module's own errors are turned into HTTP errors by the `ErrorMapper` it hands in.
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import type { DomainErrorClass, ErrorMapper } from '@shopnex/kit'
import { appService } from '@shopnex/apps'
import { auth, isSuperAdmin } from '@shopnex/auth'
import type { Shop } from '@shopnex/db/schema'
import {
  hasScope,
  resolveAdminShop,
  resolveApiToken,
  type ApiScope,
  type ApiToken,
  type ShopRole,
} from '@shopnex/tenancy'

export type Context = { headers: Headers }

export function createContext(headers: Headers): Context {
  return { headers }
}

export type { ErrorMapper }

/** The `ErrorMapper` of an error class made with `defineError`: its code's status, the code in `data`, the error as cause */
export function mapperFor<Code extends string>(errorClass: DomainErrorClass<Code>): ErrorMapper {
  return (error) => {
    if (!(error instanceof errorClass)) return undefined
    return new ORPCError(errorClass.statuses[error.code], {
      message: error.message,
      data: { code: error.code },
      cause: error,
    })
  }
}

/** Mappers tried one after the other: the first that knows the error wins */
export const firstMapper =
  (...mappers: ErrorMapper[]): ErrorMapper =>
  (error) => {
    for (const mapper of mappers) {
      const mapped = mapper(error)
      if (mapped) return mapped
    }
    return undefined
  }

/** The procedures of the Admin API (and the public ones), with `mapError` applied to every error they throw */
export function createProcedures(mapError: ErrorMapper) {
  const base = os.$context<Context>()

  const domainErrors = base.middleware(async ({ next }) => {
    try {
      return await next()
    } catch (error) {
      const mapped = mapError(error)
      if (mapped) throw mapped
      throw error
    }
  })

  const pub = base.use(domainErrors)

  // Session is resolved lazily here, so public procedures never hit the DB for it
  const authed = pub.use(async ({ context, next }) => {
    const session = await auth.api.getSession({ headers: context.headers })
    if (!session) throw new ORPCError('UNAUTHORIZED')
    return next({ context: { session: session.session, user: session.user } })
  })

  type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

  async function staffTenant({ session, user }: Session) {
    const tenant = await resolveAdminShop({
      userId: user.id,
      activeShopId: session.activeOrganizationId,
      superAdmin: isSuperAdmin(user),
    })
    if (!tenant) throw new ORPCError('FORBIDDEN', { message: 'Not a member of this shop' })
    return tenant
  }

  // Admin procedures: signed-in member of the active shop, or a super admin
  const admin = authed.use(async ({ context, next }) => {
    const tenant = await staffTenant(context)
    return next({ context: { shop: tenant.shop, role: tenant.role, superAdmin: tenant.superAdmin } })
  })

  // Who is calling an admin API procedure: staff (token null) or an API token (role and userId null)
  type ApiCaller = {
    shop: Shop
    token: ApiToken | null
    role: ShopRole | null
    superAdmin: boolean
    userId: string | null
  }

  const BEARER = /^Bearer\s+(\S+)$/i

  // Admin API for apps: a staff session (same access as `admin`) or a bearer token, which only gets what
  // `scoped()` allows: an API token (sk_…) or an app's 1-hour access token (a JWT from /oauth/token). A bearer
  // header wins over the cookie.
  const adminOrToken = pub.use(async ({ context, next }) => {
    const bearer = context.headers.get('authorization')?.match(BEARER)?.[1]
    let caller: ApiCaller
    if (bearer) {
      const resolved = (await resolveApiToken(bearer)) ?? (await appService.resolveAccessToken(bearer))
      if (!resolved) throw new ORPCError('UNAUTHORIZED', { message: 'Invalid or revoked API token' })
      caller = { shop: resolved.shop, token: resolved.token, role: null, superAdmin: false, userId: null }
    } else {
      const session = await auth.api.getSession({ headers: context.headers })
      if (!session) throw new ORPCError('UNAUTHORIZED')
      const tenant = await staffTenant(session)
      caller = {
        shop: tenant.shop,
        token: null,
        role: tenant.role,
        superAdmin: tenant.superAdmin,
        userId: session.user.id,
      }
    }
    return next({ context: caller })
  })

  // Staff always pass; tokens need the scope (write_* includes read_*)
  const scoped = (scope: ApiScope) =>
    adminOrToken.use(({ context, next }) => {
      if (context.token && !hasScope(context.token.scopes, scope)) {
        throw new ORPCError('FORBIDDEN', { message: `This API token needs the ${scope} scope` })
      }
      return next()
    })

  // Payments apps: an installed app's token with the payment session scope (staff never resolve sessions)
  const paymentsApp = scoped('write_payment_sessions').use(({ context, next }) => {
    const appId = context.token?.appId
    if (!appId) throw new ORPCError('FORBIDDEN', { message: "Only a payments app's own token can do this" })
    return next({ context: { appId } })
  })

  // AI apps: an installed app's token with the AI capability scope (staff never register capabilities)
  const aiApp = scoped('write_ai_capabilities').use(({ context, next }) => {
    const appId = context.token?.appId
    if (!appId) throw new ORPCError('FORBIDDEN', { message: "Only an AI app's own token can do this" })
    return next({ context: { appId } })
  })

  // Carrier services: an installed app's token with the shipping scope (staff manage them from the admin instead)
  const carrierApp = scoped('write_shipping').use(({ context, next }) => {
    const appId = context.token?.appId
    if (!appId) throw new ORPCError('FORBIDDEN', { message: "Only a carrier app's own token can do this" })
    return next({ context: { appId } })
  })

  // Shop settings (keys, etc.): owners/admins of the shop, or a super admin
  const shopManager = admin.use(async ({ context, next }) => {
    if (!context.superAdmin && context.role !== 'owner' && context.role !== 'admin') {
      throw new ORPCError('FORBIDDEN', { message: 'Requires shop owner or admin' })
    }
    return next()
  })

  // Webhooks: shop owners/admins, or an API token (which only sees the subscriptions it created)
  const webhookManager = adminOrToken.use(async ({ context, next }) => {
    if (!context.token && !context.superAdmin && context.role !== 'owner' && context.role !== 'admin') {
      throw new ORPCError('FORBIDDEN', { message: 'Requires shop owner or admin' })
    }
    return next()
  })

  // Platform-wide settings (the app registry): super admins only
  const superAdminOnly = admin.use(async ({ context, next }) => {
    if (!context.superAdmin) throw new ORPCError('FORBIDDEN', { message: 'Requires a super admin' })
    return next()
  })

  return {
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
  }
}

/** `?limit=&offset=` of a list route; routes of any module use the same one */
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
