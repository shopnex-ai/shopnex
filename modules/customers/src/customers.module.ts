import { defineModule } from '@shopnex/kit'
import { customers as customerRoutes } from './customers.router'
import { customerLoginCodes, customerSessions, customers } from './customers.schema'

// The customers table is pointed at by orders and carts; the customer's export and erase are @shopnex/privacy's (they read orders, carts and emails)
export const customersModule = defineModule({
  name: 'customers',
  dependsOn: ['auth', 'core', 'custom-fields', 'db', 'rpc', 'webhooks'],
  tables: { customers, customerLoginCodes, customerSessions },
  router: { customers: customerRoutes },
})
