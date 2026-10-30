export { createStorefrontClient } from './client'
export type { StorefrontClient, StorefrontClientOptions } from './client'
export { API_BASE_PATH, CUSTOMER_TOKEN_HEADER, PUBLISHABLE_KEY_HEADER } from './constants'
export {
  storefrontContract,
  storefrontErrorMap,
  type StorefrontContract,
  type StorefrontErrorCode,
  type StorefrontErrorMap,
  type StorefrontInputs,
  type StorefrontOutputs,
} from './contract'
export * from './schemas'
export * from './theme'
// Typed error handling: `isDefinedError(e) && e.code === 'OUT_OF_STOCK'` narrows `e.data`
export { ORPCError, isDefinedError, safe } from '@orpc/client'
