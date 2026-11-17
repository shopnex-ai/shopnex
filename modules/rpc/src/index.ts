// The building blocks of a route: who is calling (staff, an API token, an app's token), the shop it acts on, and the
// scopes it needs. Every module that exposes routes builds its procedures from here, and `modules/api` does too.
// Nothing here knows a module, and nothing here knows how a login or a token is checked: `modules/api` registers those
// functions once (`configureRpc`), so a module that sits below auth or tenancy can have routes too.
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { domainErrorData, domainErrorStatus, isDomainError, type ErrorMapper } from '@shopnex/kit'
import type { ApiScope, ApiToken, Shop } from '@shopnex/db/schema'

// The roles a member can have in a shop (tenancy's ShopRole is the same union; rpc does not depend on tenancy)
export type ShopRole = 'owner' | 'admin' | 'member'

export type Context = { headers: Headers }

export function createContext(headers: Headers): Context {
  return { headers }
}

/**
 * Filled in by the app that registers the resolvers, to give the signed-in staff member its exact type without this
 * package depending on the login library (`declare module '@shopnex/rpc' { interface Register { session: … } }`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by modules/api
export interface Register {}

/** What a handler can read of the signed-in staff member: the registered type, else the least every login has */
export type StaffSession = Register extends { session: infer S }
  ? S
  : { session: { activeOrganizationId?: string | null }; user: { id: string } }

/** How a request is recognised. Registered once by `modules/api`, which knows about logins, tokens and shops. */
export interface Resolvers {
  /** The signed-in staff member of the request, or null */
  session(headers: Headers): Promise<StaffSession | null>
  /** The shop that member acts on (their active one), or null when they are not a member of it */
  adminShop(session: StaffSession): Promise<{ shop: Shop; role: ShopRole; superAdmin: boolean } | null>
  /** An API token or an app's access token (the bearer): its shop and token, or null when invalid or revoked */
  token(bearer: string): Promise<{ shop: Shop; token: ApiToken } | null>
  /** Whether a token's scopes allow what a route needs (write includes read) */
  hasScope(scopes: readonly ApiScope[], needed: ApiScope): boolean
}

// On globalThis so a dev server that loads this file twice (hot reload) still finds what was registered
const SLOT = Symbol.for('shopnex.rpc.resolvers')

export function configureRpc(resolvers: Resolvers) {
  ;(globalThis as Record<symbol, Resolvers>)[SLOT] = resolvers
}

const registered = () => (globalThis as Record<symbol, Resolvers | undefined>)[SLOT]

function resolvers(): Resolvers {
  const found = registered()
  if (!found)
    throw new Error('@shopnex/rpc has no resolvers: call configureRpc(...) once at startup (modules/api does)')
  return found
}

/** For an entry point that mounts routes: fails at startup, with the reason, instead of at the first request */
export function assertRpcConfigured() {
  resolvers()
}

export type { ErrorMapper }

/**
 * The answer for any error made with `defineError`: the status its class declares for the code, the code in `data`, the error as
 * the cause. Routes use it by default, so a module needs no mapper; `createProcedures` and `configureRpc` can still add one
 * for an error that must answer differently.
 */
export const domainErrorMapper: ErrorMapper = (error) => {
  if (!isDomainError(error)) return undefined
  return new ORPCError(domainErrorStatus(error) ?? 'INTERNAL_SERVER_ERROR', {
    message: error.message,
    data: domainErrorData(error),
    cause: error,
  })
}

/** The procedures of the Admin API (and the public ones), with `mapError` applied to every error they throw (none: a module with no errors of its own) */
export function createProcedures(mapError: ErrorMapper = () => undefined) {
  const base = os.$context<Context>()

  const domainErrors = base.middleware(async ({ next }) => {
    try {
      return await next()
    } catch (error) {
      // The route's own mapper, then the default for errors made with defineError
      const mapped = mapError(error) ?? domainErrorMapper(error)
      if (mapped) throw mapped
      throw error
    }
  })

  const pub = base.use(domainErrors)

  // Session is resolved lazily here, so public procedures never hit the DB for it
  const authed = pub.use(async ({ context, next }) => {
    const found = await resolvers().session(context.headers)
    if (!found) throw new ORPCError('UNAUTHORIZED')
    return next({ context: { session: found.session, user: found.user } })
  })

  async function staffTenant(session: StaffSession) {
    const tenant = await resolvers().adminShop(session)
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
      const resolved = await resolvers().token(bearer)
      if (!resolved) throw new ORPCError('UNAUTHORIZED', { message: 'Invalid or revoked API token' })
      caller = { shop: resolved.shop, token: resolved.token, role: null, superAdmin: false, userId: null }
    } else {
      const session = await resolvers().session(context.headers)
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
      if (context.token && !resolvers().hasScope(context.token.scopes, scope)) {
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
