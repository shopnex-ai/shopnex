// The Storefront API, server side. Every page reads its data through `shopnex`; the browser talks to the
// same API for the cart (core/cart), with the settings from `browserConfig`.
import { AsyncLocalStorage } from 'node:async_hooks'
import { ORPCError, createStorefrontClient, safe } from '@shopnex/storefront-sdk'

// process.env first: a production build must read these when it starts, not when it was built
// (import.meta.env is what `astro dev` fills from .env)
const env = (name: 'SHOPNEX_URL' | 'SHOPNEX_PUBLIC_URL' | 'SHOPNEX_PUBLISHABLE_KEY') =>
  process.env[name] ?? import.meta.env[name]

const baseUrl = env('SHOPNEX_URL') ?? 'http://localhost:3000'
const publishableKey = env('SHOPNEX_PUBLISHABLE_KEY') || undefined

// Multi-tenant Shopnex (TENANCY_MODE=multi) tells shops apart by the host a buyer used. The clients below are
// shared by every request, so the middleware (src/middleware.ts) records the host in `requestContext` and each
// API call passes it on as x-forwarded-host; the browser then calls the storefront's own origin.
const multiTenant = process.env.TENANCY_MODE === 'multi'

export const requestContext = new AsyncLocalStorage<{ host: string; origin: string }>()

const hostAwareFetch: typeof fetch = (input, init) => {
  const host = multiTenant ? requestContext.getStore()?.host : undefined
  if (!host) return fetch(input, init)
  const request = new Request(input, init)
  request.headers.set('x-forwarded-host', host)
  return fetch(request)
}

export const shopnex = createStorefrontClient({ baseUrl, publishableKey, fetch: hostAwareFetch })

/** A client acting for a signed-in customer (their token from the account cookie, see core/account) */
export const shopnexFor = (customerToken: string | undefined) =>
  createStorefrontClient({ baseUrl, publishableKey, customerToken, fetch: hostAwareFetch })

/** What the browser needs to call the Storefront API (both are public) */
export const browserConfig = {
  baseUrl: env('SHOPNEX_PUBLIC_URL') || baseUrl,
  publishableKey: publishableKey ?? null,
}

/**
 * Where this page's scripts call the Storefront API. Multi-tenant: the page's own origin (the proxy sends
 * /api/* to Shopnex, and the host tells it which shop). Otherwise the configured origin.
 */
export const browserBaseUrl = () => (multiTenant && requestContext.getStore()?.origin) || browserConfig.baseUrl

/** The result, or null when Shopnex answers NOT_FOUND (unknown handle). Other errors are thrown. */
export async function orNull<T>(request: Promise<T>): Promise<T | null> {
  const [error, data] = await safe(request)
  if (!error) return data
  if (error instanceof ORPCError && error.code === 'NOT_FOUND') return null
  throw error
}
