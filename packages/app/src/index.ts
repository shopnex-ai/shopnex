// @shopnex/app: everything an app needs to talk to Shopnex, with nothing to store. Set SHOPNEX_CLIENT_ID and
// SHOPNEX_APP_KEY (from the app registry or the marketplace dashboard), then:
//
//   const shopnex = createShopnexApp()
//   const app = new Hono()
//   app.route('/', shopnex.routes)
//   app.get('/api/stats', async (c) => {
//     const { shop, admin } = await shopnex.authenticate(c)
//     return c.json({ shop: shop.name, orders: await admin.get('/orders?limit=1') })
//   })
//
// How it stays stateless: Shopnex signs session tokens, payments requests and webhooks with its own key
// (checked against {instance}/api/v1/oauth/jwks); the app proves who it is with client assertions signed by
// its key and gets 1-hour Admin API tokens on demand (token exchange / client credentials), cached in memory.
// Per-shop settings live in the shop's Shopnex (`data`).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  CLIENT_ASSERTION_TYPE,
  createClientAssertion,
  createJwksResolver,
  importPrivateKey,
  publicKeyOf,
  verify,
  type JwksResolverOptions,
} from '@shopnex/marketplace-sdk/keys'
import {
  verifyPaymentsRequest as verifyPayments,
  type PaymentSessionRequest,
  type RefundSessionRequest,
} from '@shopnex/marketplace-sdk/payments'
import { verifyRatesRequest as verifyRates, type RatesRequest } from '@shopnex/marketplace-sdk/shipping'
import { verifySessionToken } from '@shopnex/marketplace-sdk/session-token'
import {
  createAdminClient,
  createAppData,
  deriveDataKey,
  errorOf,
  remoteKeyValue,
  type AdminClient,
  type AppData,
} from './admin'
import { clientScript } from './client'

export { ShopnexError, type AdminClient, type AppData } from './admin'
export type { PaymentSessionRequest, RefundSessionRequest } from '@shopnex/marketplace-sdk/payments'
export type { Rate, RatesRequest, RatesResponse } from '@shopnex/marketplace-sdk/shipping'

export type ShopnexAppOptions = {
  /** Default: SHOPNEX_CLIENT_ID */
  clientId?: string
  /** The app's private key (snxk_…). Default: SHOPNEX_APP_KEY */
  appKey?: string
  /**
   * Only trust instances the marketplace reports this app installed on (marketplace apps: anyone can run a
   * Shopnex instance). Default: SHOPNEX_MARKETPLACE_URL; unset, any instance that installed the app is served.
   */
  marketplaceUrl?: string
  /** Where the app keeps a shop's data. Default: the shop's storage in Shopnex; see `openLocalStore` for SQLite */
  data?: (instance: string, shopId: string) => AppData
  /** Instances allowed over plain http (default: localhost only) */
  allowHttp?: JwksResolverOptions['allowHttp']
  /**
   * Where to send requests to the Shopnex instance when its public address isn't reachable from here (Docker:
   * http://shopnex:3000). Only the request goes there; the instance keeps its public identity. For apps bundled
   * with one self-hosted Shopnex, not for marketplace apps serving many instances. Default: SHOPNEX_INTERNAL_URL
   */
  instanceInternalUrl?: string
}

/** One shop the app is installed on, with an Admin API client for it */
export type ShopContext = {
  /** The Shopnex instance's origin, e.g. https://shop.example.com */
  instance: string
  shopId: string
  installationId: string
  admin: AdminClient
  /** The app's own storage on this shop */
  data: AppData
  /** Payments apps: report the outcome of a payment / refund session */
  payments: {
    resolve(sessionId: string, externalId?: string): Promise<void>
    reject(sessionId: string, reason: string): Promise<void>
    /** Registers (or updates) this app's payment method for the shop */
    configure(method: {
      name: string
      gateway: string
      paymentSessionUrl: string
      refundSessionUrl?: string
      ready: boolean
    }): Promise<void>
  }
  /** Carrier apps: quote shipping rates at checkout */
  shipping: {
    /** Registers (or updates) this app's carrier service for the shop. Its `id` is in the rate ids on orders. */
    configure(service: {
      name: string
      ratesUrl: string
      ready: boolean
    }): Promise<{ id: string; name: string; active: boolean; ready: boolean }>
  }
}

export type Shop = { id: string; name: string; currency: string; [key: string]: unknown }

/** A staff member using the app inside the admin right now */
export type Session = ShopContext & {
  shop: Shop
  /** Staff user id */
  userId: string
}

type Token = { accessToken: string; expiresAt: number; installationId: string }

const env = (name: string) => (typeof process !== 'undefined' ? process.env[name] : undefined)
const BEARER = /^Bearer\s+(\S+)$/i

export function createShopnexApp(options: ShopnexAppOptions = {}) {
  const clientId = options.clientId ?? env('SHOPNEX_CLIENT_ID')
  const appKey = options.appKey ?? env('SHOPNEX_APP_KEY')
  if (!clientId) throw new Error('@shopnex/app: set SHOPNEX_CLIENT_ID (or pass clientId)')
  if (!appKey) throw new Error('@shopnex/app: set SHOPNEX_APP_KEY (or pass appKey)')
  const marketplaceUrl = (options.marketplaceUrl ?? env('SHOPNEX_MARKETPLACE_URL'))?.replace(/\/$/, '')
  const internalUrl = (options.instanceInternalUrl ?? env('SHOPNEX_INTERNAL_URL'))?.trim().replace(/\/$/, '')
  // Requests to the instance go to its internal address when one is set
  const reach = (url: string) => (internalUrl ? internalUrl + url.slice(new URL(url).origin.length) : url)

  const privateKey = importPrivateKey(appKey)
  const dataKey = deriveDataKey(appKey)
  const keys = createJwksResolver({
    allowHttp: options.allowHttp,
    fetch: (input, init) => fetch(typeof input === 'string' ? reach(input) : input, init),
  })

  // --- access tokens, cached per (instance, shop) until a minute before they expire ---

  const tokens = new Map<string, Promise<Token>>()
  const shops = new Map<string, { shop: Shop; at: number }>()
  const verified = new Map<string, number>()

  async function requestToken(instance: string, grant: Record<string, string>): Promise<Token> {
    const res = await fetch(reach(`${instance}/api/v1/oauth/token`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...grant,
        client_id: clientId,
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: await createClientAssertion(await privateKey, clientId!, instance),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw await errorOf(res, `Token from ${instance}`)
    const body = (await res.json()) as { access_token: string; expires_in: number; installation_id: string }
    return {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
      installationId: body.installation_id,
    }
  }

  // `sid`: the installation a session token is for; a cached token for an older installation is replaced
  async function token(instance: string, shopId: string, sessionToken?: string, sid?: string) {
    const key = `${instance}|${shopId}`
    const cached = await tokens.get(key)?.catch(() => null)
    if (cached && cached.expiresAt > Date.now() && (!sid || cached.installationId === sid)) return cached
    const next = requestToken(
      instance,
      sessionToken
        ? { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: sessionToken }
        : { grant_type: 'client_credentials', shop_id: shopId },
    )
    tokens.set(key, next)
    next.catch(() => tokens.get(key) === next && tokens.delete(key))
    return next
  }

  // Marketplace apps: the marketplace must know this install (cached for an hour)
  async function checkMarketplace(instance: string, shopId: string) {
    if (!marketplaceUrl) return
    const key = `${instance}|${shopId}`
    if ((verified.get(key) ?? 0) > Date.now()) return
    const res = await fetch(`${marketplaceUrl}/api/v1/installations/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_assertion: await createClientAssertion(await privateKey, clientId!, marketplaceUrl),
        instance_url: instance,
        shop_id: shopId,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw await errorOf(res, 'Marketplace verify')
    const body = (await res.json()) as { installed: boolean }
    if (!body.installed) throw new HTTPException(403, { message: 'The marketplace has no record of this install' })
    verified.set(key, Date.now() + 3600_000)
  }

  function shopContext(instance: string, shopId: string, first: Token): ShopContext {
    const admin = createAdminClient(instance, async () => (await token(instance, shopId)).accessToken, reach(instance))
    const session = (id: string, action: string) => `/payment-sessions/${encodeURIComponent(id)}/${action}`
    return {
      instance,
      shopId,
      installationId: first.installationId,
      admin,
      data: options.data?.(instance, shopId) ?? createAppData(remoteKeyValue(admin), dataKey),
      payments: {
        resolve: async (id, externalId) => void (await admin.post(session(id, 'resolve'), { externalId })),
        reject: async (id, reason) => void (await admin.post(session(id, 'reject'), { reason })),
        configure: async (method) => void (await admin.post('/payments-app/configure', method)),
      },
      shipping: {
        configure: (service) => admin.post('/carrier-services/configure', service),
      },
    }
  }

  /** A shop the app is installed on, for background work (provider webhooks, jobs) */
  async function forShop(instance: string, shopId: string): Promise<ShopContext> {
    const origin = new URL(instance).origin
    await checkMarketplace(origin, shopId)
    return shopContext(origin, shopId, await token(origin, shopId))
  }

  async function shopDetails(ctx: ShopContext) {
    const key = `${ctx.instance}|${ctx.shopId}`
    const cached = shops.get(key)
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.shop
    const shop = await ctx.admin.get<Shop>('/shop')
    shops.set(key, { shop, at: Date.now() })
    return shop
  }

  /**
   * The staff member using the app: checks the session token (Authorization: Bearer, from the app bridge, or
   * ?session_token= on the embedded page load) and returns their shop with an Admin API client. Throws a 401
   * HTTPException otherwise. On a Hono context, also lets only that shop's admin frame the page.
   */
  async function authenticate(c: Context | Request): Promise<Session> {
    const request = c instanceof Request ? c : c.req.raw
    const sessionToken =
      request.headers.get('authorization')?.match(BEARER)?.[1] ??
      new URL(request.url).searchParams.get('session_token') ??
      undefined
    const claims = sessionToken && (await verifySessionToken(sessionToken, { clientId: clientId!, keys }))
    if (!claims) {
      throw new HTTPException(401, {
        res: new Response('Open this app from your Shopnex admin.', { status: 401 }),
      })
    }
    if (!(c instanceof Request)) c.header('Content-Security-Policy', `frame-ancestors ${claims.iss}`)
    await checkMarketplace(claims.iss, claims.shop_id)
    const ctx = shopContext(
      claims.iss,
      claims.shop_id,
      await token(claims.iss, claims.shop_id, sessionToken, claims.sid),
    )
    return { ...ctx, shop: await shopDetails(ctx), userId: claims.sub }
  }

  /**
   * Payments apps: a payment or refund session request from Shopnex, checked against the instance's keys, with
   * its shop. Throws a 401 HTTPException when the signature doesn't check out.
   */
  async function verifyPaymentsRequest<K extends 'payment' | 'refund'>(
    c: Context | Request,
    kind: K,
  ): Promise<{
    request: K extends 'payment' ? PaymentSessionRequest : RefundSessionRequest
    shop: ShopContext
  }> {
    const request = c instanceof Request ? c : c.req.raw
    const verified = await verifyPayments(request.headers, await request.text(), { keys })
    if (!verified || verified.kind !== kind) throw new HTTPException(401, { message: 'Invalid signature' })
    return {
      request: verified as K extends 'payment' ? PaymentSessionRequest : RefundSessionRequest,
      shop: await forShop(verified.instance, verified.shopId),
    }
  }

  /**
   * Carrier apps: a rates request from Shopnex, checked against the instance's keys, with its shop. Answer it with
   * `{ rates: [{ code, name, priceCents, description? }] }`. Throws a 401 HTTPException when the signature doesn't
   * check out.
   */
  async function verifyRatesRequest(c: Context | Request): Promise<{ request: RatesRequest; shop: ShopContext }> {
    const request = c instanceof Request ? c : c.req.raw
    const verified = await verifyRates(request.headers, await request.text(), { keys })
    if (!verified) throw new HTTPException(401, { message: 'Invalid signature' })
    return { request: verified, shop: await forShop(verified.instance, verified.shopId) }
  }

  /**
   * A webhook delivery from Shopnex (subscriptions the app made with its token), checked against the instance's
   * keys: no endpoint secret to keep. Throws a 401 HTTPException when the signature doesn't check out.
   */
  async function verifyWebhook<T = unknown>(
    c: Context | Request,
  ): Promise<{ event: { type: string; timestamp: string; shopId: string; data: T }; shop: ShopContext }> {
    const request = c instanceof Request ? c : c.req.raw
    const body = await request.text()
    const h = request.headers
    const id = h.get('webhook-id')
    const timestamp = h.get('webhook-timestamp')
    const instance = h.get('shopnex-instance')
    const fail = () => new HTTPException(401, { message: 'Invalid signature' })
    if (!id || !timestamp || !instance || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw fail()
    const key = await keys(instance, h.get('shopnex-key-id') ?? undefined)
    const message = `${id}.${timestamp}.${body}`
    let valid = false
    for (const s of (h.get('webhook-signature') ?? '').split(' ')) {
      if (key && s.startsWith('v1a,') && (await verify(key, message, s.slice(4)))) valid = true
    }
    if (!valid) throw fail()
    const event = JSON.parse(body) as { type: string; timestamp: string; shopId: string; data: T }
    return { event, shop: await forShop(instance, event.shopId) }
  }

  const appBridgeJs = readFileSync(fileURLToPath(import.meta.resolve('@shopnex/app-bridge')), 'utf8')

  /** Serves the browser side of the UI components (and the app bridge) under /shopnex/ */
  const routes = new Hono()
  routes.get('/shopnex/app-bridge.js', (c) =>
    c.body(appBridgeJs, 200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=300' }),
  )
  routes.get('/shopnex/app.js', (c) =>
    c.body(clientScript, 200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=300' }),
  )
  // Who this app is, for an instance that knows only its URL (bundled apps: Shopnex reads this at startup)
  routes.get('/.well-known/shopnex-app.json', async (c) =>
    c.json({ clientId, publicKey: await publicKeyOf(await privateKey) }, 200, { 'cache-control': 'no-store' }),
  )

  return { clientId, routes, authenticate, forShop, verifyPaymentsRequest, verifyRatesRequest, verifyWebhook }
}

export type ShopnexApp = ReturnType<typeof createShopnexApp>
