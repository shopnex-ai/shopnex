import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with. Every message is meant for the shop owner.
export const StoreImportError = defineError('StoreImportError', {
  // The address is not a public store address
  INVALID_STORE_ADDRESS: 'BAD_REQUEST',
  // The store can't be read: closed catalog, password, not Shopify or WooCommerce, or it did not answer
  STORE_NOT_READABLE: 'BAD_REQUEST',
  // Another import of this shop is still running
  IMPORT_RUNNING: 'CONFLICT',
  // Too many imports from this shop today, or the server is busy
  IMPORT_LIMIT: 'TOO_MANY_REQUESTS',
  // The shop already sells in another currency and the import would mislabel its prices
  CURRENCY_MISMATCH: 'CONFLICT',
})
export type StoreImportError = InstanceType<typeof StoreImportError>
export type StoreImportErrorCode = ErrorCode<typeof StoreImportError>
