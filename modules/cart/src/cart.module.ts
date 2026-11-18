import { defineModule } from '@shopnex/kit'
import './cart.hooks'
import {
  carrierServices as carrierServiceRoutes,
  carrierServicesApp as carrierAppRoutes,
  shippingRates as shippingRateRoutes,
} from './cart.router'
import { cartLines, carts, carrierServices, shippingRates } from './cart.schema'

// carts point at orders, customers, channels and variants (still tables in db); email_deliveries points at carts, so email sits above this
export const cartModule = defineModule({
  name: 'cart',
  dependsOn: ['apps', 'catalog', 'core', 'db', 'marketplace-sdk', 'orders', 'payments', 'pricing', 'rpc'],
  tables: { cartLines, carts, carrierServices, shippingRates },
  router: {
    shippingRates: shippingRateRoutes,
    carrierServices: carrierServiceRoutes,
    carrierServicesApp: carrierAppRoutes,
  },
})
