import { defineModule } from '@shopnex/kit'
import { storefrontRouter } from './storefront.router'

// No tables and no contract of its own: the shapes are @shopnex/storefront-sdk's, which any storefront can use. This module implements that
// contract on top of the others, so it sits above all of them and nothing depends on it but the API that mounts it.
export const storefrontModule = defineModule({
  name: 'storefront',
  dependsOn: [
    'apps',
    'auth',
    'cart',
    'catalog',
    'channels',
    'content',
    'custom-fields',
    'customers',
    'db',
    'email',
    'gift-cards',
    'languages',
    'orders',
    'pricing',
    'rpc',
    'storefront-sdk',
    'tenancy',
    'theme',
  ],
  router: { storefront: storefrontRouter },
})
