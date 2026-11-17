import { defineModule } from '@shopnex/kit'
import './webhooks.hooks'
import { webhooks } from './webhooks.router'
import { webhookDeliveries, webhookEndpoints } from './webhooks.schema'

export const webhooksModule = defineModule({
  name: 'webhooks',
  dependsOn: ['db', 'rpc', 'tenancy'],
  tables: { webhookEndpoints, webhookDeliveries },
  router: webhooks,
})
