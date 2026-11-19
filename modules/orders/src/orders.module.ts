import { defineModule } from '@shopnex/kit'
import './orders.hooks'
import { analytics, orders as orderRoutes } from './orders.router'
import {
  discountRedemptions,
  fulfillments,
  orderItems,
  orderShippingLines,
  orderTransactions,
  orders,
} from './orders.schema'

// Cancelling and refunding an order are routes of @shopnex/payments (they send the refund to the payments app, which depends on orders)
export const ordersModule = defineModule({
  name: 'orders',
  dependsOn: [
    'catalog',
    'channels',
    'core',
    'custom-fields',
    'customers',
    'db',
    'pricing',
    'rpc',
    'storefront-sdk',
    'webhooks',
  ],
  tables: { discountRedemptions, fulfillments, orderItems, orderShippingLines, orderTransactions, orders },
  router: { orders: orderRoutes, analytics },
})
