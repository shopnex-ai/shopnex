import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { marketplaceContract, type MarketplaceContract } from './contract'

/** Path of the API on the marketplace origin */
export const MARKETPLACE_API_PATH = '/api/v1'

export type MarketplaceClientOptions = {
  /** Marketplace origin, e.g. https://apps.shopnex.com or http://localhost:3200 */
  baseUrl: string
  /** mk_… key from connect (Shopnex instances). Apps don't need one: verify takes client credentials. */
  instanceKey?: string
  fetch?: typeof fetch
}

export type MarketplaceClient = JsonifiedClient<ContractRouterClient<MarketplaceContract>>

export function createMarketplaceClient(options: MarketplaceClientOptions): MarketplaceClient {
  const link = new OpenAPILink(marketplaceContract, {
    url: `${options.baseUrl.replace(/\/$/, '')}${MARKETPLACE_API_PATH}`,
    headers: () => (options.instanceKey ? { authorization: `Bearer ${options.instanceKey}` } : {}),
    fetch: options.fetch,
  })
  return createORPCClient(link)
}
