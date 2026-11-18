import { defineModule } from '@shopnex/kit'
import { customers as customerRoutes } from './privacy.router'

// No tables of its own. It reads what customers, orders, carts and emails hold, so it sits above all of them (the customers module cannot:
// orders use customers). Its two routes, a customer's data export and erase, are part of /admin/customers: the api package puts them there.
export const privacyModule = defineModule({
  name: 'privacy',
  dependsOn: [
    'auth',
    'cart',
    'core',
    'custom-fields',
    'customers',
    'db',
    'email',
    'orders',
    'rpc',
    'tenancy',
    'webhooks',
  ],
  router: { customers: customerRoutes },
})
