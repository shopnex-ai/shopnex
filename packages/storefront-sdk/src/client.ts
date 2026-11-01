import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { API_BASE_PATH, CUSTOMER_TOKEN_HEADER, PUBLISHABLE_KEY_HEADER } from './constants'
import { storefrontContract, type StorefrontContract } from './contract'

export type StorefrontClientOptions = {
  /** Shopnex origin, e.g. https://shop.example.com or http://localhost:3000 */
  baseUrl: string
  /** pk_… key from the admin. Optional in single-tenant mode or on a shop's own domain. */
  publishableKey?: string
  /** The signed-in customer's token (from `customer.signIn`); a function when it changes between requests */
  customerToken?: string | null | (() => string | null | undefined)
  fetch?: typeof fetch
}

export type StorefrontClient = JsonifiedClient<ContractRouterClient<StorefrontContract>>

// Talks to the public REST surface (/api/v1/storefront/*), so it works from any runtime:
// browser, Node, Astro, Next server components, edge.
export function createStorefrontClient(options: StorefrontClientOptions): StorefrontClient {
  const link = new OpenAPILink(storefrontContract, {
    url: `${options.baseUrl.replace(/\/$/, '')}${API_BASE_PATH}`,
    headers: () => {
      const token = typeof options.customerToken === 'function' ? options.customerToken() : options.customerToken
      return {
        ...(options.publishableKey && { [PUBLISHABLE_KEY_HEADER]: options.publishableKey }),
        ...(token && { [CUSTOMER_TOKEN_HEADER]: token }),
      }
    },
    fetch: options.fetch,
  })
  return createORPCClient(link)
}
