import { defineModule } from '@shopnex/kit'
import './payments.hooks'
import {
  paymentApps,
  paymentMethods as paymentMethodRoutes,
  paymentSessions as paymentSessionRoutes,
  paymentsAppApi,
} from './payments.router'
import { paymentMethods, paymentSessions } from './payments.schema'

export const paymentsModule = defineModule({
  name: 'payments',
  dependsOn: ['apps', 'core', 'db', 'email', 'marketplace-sdk', 'orders', 'rpc', 'webhooks'],
  tables: { paymentMethods, paymentSessions },
  router: {
    paymentMethods: paymentMethodRoutes,
    paymentApps,
    paymentsApp: paymentsAppApi,
    paymentSessions: paymentSessionRoutes,
  },
})
