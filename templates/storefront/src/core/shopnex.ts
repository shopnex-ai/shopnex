// The Storefront API, server side. Every page reads its data through `shopnex`; the browser talks to the
// same API for the cart (core/cart), with the settings from `browserConfig`.
import { ORPCError, createStorefrontClient, safe } from '@shopnex/storefront-sdk'

const baseUrl = import.meta.env.SHOPNEX_URL ?? 'http://localhost:3000'
const publishableKey = import.meta.env.SHOPNEX_PUBLISHABLE_KEY || undefined

export const shopnex = createStorefrontClient({ baseUrl, publishableKey })

/** What the browser needs to call the Storefront API (both are public) */
export const browserConfig = {
  baseUrl: import.meta.env.SHOPNEX_PUBLIC_URL || baseUrl,
  publishableKey: publishableKey ?? null,
}

/** The result, or null when Shopnex answers NOT_FOUND (unknown handle). Other errors are thrown. */
export async function orNull<T>(request: Promise<T>): Promise<T | null> {
  const [error, data] = await safe(request)
  if (!error) return data
  if (error instanceof ORPCError && error.code === 'NOT_FOUND') return null
  throw error
}
