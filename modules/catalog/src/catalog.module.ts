import { defineModule } from '@shopnex/kit'
import { collections as collectionRoutes, products as productRoutes } from './catalog.router'
import {
  collections,
  productCollections,
  productImages,
  productOptionValues,
  productOptions,
  productVariants,
  products,
  variantOptionValues,
} from './catalog.schema'

export const catalogModule = defineModule({
  name: 'catalog',
  dependsOn: ['channels', 'core', 'custom-fields', 'db', 'languages', 'rpc', 'webhooks'],
  tables: {
    collections,
    productCollections,
    productImages,
    productOptionValues,
    productOptions,
    productVariants,
    products,
    variantOptionValues,
  },
  router: { products: productRoutes, collections: collectionRoutes },
})
