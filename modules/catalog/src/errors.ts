export type CatalogErrorCode =
  | 'SLUG_TAKEN'
  | 'SKU_TAKEN'
  | 'PRODUCT_NOT_FOUND'
  | 'COLLECTION_NOT_FOUND'
  | 'INVALID_VARIANTS'
  // Price lives on variants: a product with several variants can't take a single priceCents
  | 'HAS_VARIANTS'

// Domain error; the API layer maps it to an HTTP error
export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CatalogError'
  }
}
