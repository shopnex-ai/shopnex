import { defineModule } from '@shopnex/kit'
import { collections as collectionRoutes, products as productRoutes } from './catalog.router'
import {
  collections,
  productCollections,
  productImages,
  productOptionValues,
  productOptions,
  variantOptionValues,
} from './catalog.schema'

// products and product_variants are listed by db until orders and cart (which point at them) move too
export const catalogModule = defineModule({
  name: 'catalog',
  dependsOn: ['channels', 'core', 'custom-fields', 'db', 'rpc', 'webhooks'],
  tables: { collections, productCollections, productImages, productOptionValues, productOptions, variantOptionValues },
  router: { products: productRoutes, collections: collectionRoutes },
})
