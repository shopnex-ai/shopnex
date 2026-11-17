import { defineError, type ErrorCode } from '@shopnex/kit'

// Domain error; each code's status is the one the Admin API answers with
export const CatalogError = defineError('CatalogError', {
  SLUG_TAKEN: 'CONFLICT',
  SKU_TAKEN: 'CONFLICT',
  PRODUCT_NOT_FOUND: 'NOT_FOUND',
  COLLECTION_NOT_FOUND: 'NOT_FOUND',
  INVALID_VARIANTS: 'BAD_REQUEST',
  // Price lives on variants: a product with several variants can't take a single priceCents
  HAS_VARIANTS: 'BAD_REQUEST',
})
export type CatalogError = InstanceType<typeof CatalogError>
export type CatalogErrorCode = ErrorCode<typeof CatalogError>
