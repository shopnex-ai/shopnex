import { defineModule } from '@shopnex/kit'
import './email.hooks'
import { email as emailRoutes, notifications as notificationRoutes } from './email.router'
import {
  abandonedCartSettings,
  emailDeliveries,
  emailSettings,
  emailSuppressions,
  emailTemplates,
} from './email.schema'

// It sits above orders and carts: it reads them, and email_deliveries points at them (which are still tables in db)
export const emailModule = defineModule({
  name: 'email',
  dependsOn: ['cart', 'catalog', 'core', 'customers', 'db', 'orders', 'rpc', 'storefront-sdk', 'tenancy', 'webhooks'],
  tables: { abandonedCartSettings, emailDeliveries, emailSettings, emailSuppressions, emailTemplates },
  router: { email: emailRoutes, notifications: notificationRoutes },
})
