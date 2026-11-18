import { defineModule } from '@shopnex/kit'
import { webhooks } from './webhooks.router'
import { webhookDeliveries, webhookEndpoints } from './webhooks.schema'

export const webhooksModule = defineModule({
  name: 'webhooks',
  dependsOn: ['core', 'db', 'rpc'],
  tables: { webhookEndpoints, webhookDeliveries },
  router: webhooks,
})
