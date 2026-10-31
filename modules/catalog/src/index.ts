export * as productService from './products'
export * as collectionService from './collections'
export * as variantService from './variants'
export type {
  Facets,
  FilterOptions,
  ImageInput,
  ListOptions,
  ProductInput,
  ProductSortKey,
  ProductWithDetails,
} from './products'
export type { CollectionInput } from './collections'
export type {
  OptionDetail,
  OptionInput,
  OptionValueDetail,
  VariantDetail,
  VariantInput,
  VariantsInput,
} from './variants'
export { DEFAULT_VARIANT_TITLE } from './variants'
export { escapeHtml, htmlToText, sanitizeHtml } from './html'
export { seedSampleProducts } from './sample'
export { CatalogError, type CatalogErrorCode } from './errors'
export { SLUG_PATTERN, slugify } from './slug'
export { PRODUCT_STATUSES } from '@shopnex/db/schema'
export type { Collection, NewProduct, Product, ProductStatus, ProductVariant } from '@shopnex/db/schema'
