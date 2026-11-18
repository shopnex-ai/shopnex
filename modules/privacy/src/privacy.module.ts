import { defineModule } from '@shopnex/kit'

// No tables and no routes of its own: it reads what customers, orders, carts and emails hold, so it sits above all of them (the
// customers module cannot, because orders use customers). The admin routes that call it are the customers' export and erase.
export const privacyModule = defineModule({
  name: 'privacy',
  dependsOn: ['auth', 'core', 'db', 'tenancy', 'webhooks'],
})
