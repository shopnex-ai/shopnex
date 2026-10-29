import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { hasScope, type ApiScope, type ApiToken } from '@shopnex/tenancy'
import { webhookService, type WebhookTopic } from '@shopnex/webhooks'
import { webhookManager } from '../../orpc'
import { pagination } from '../pagination'
import { webhookEndpointInput } from './schemas'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// An app may only subscribe to data it can read: order.* needs read_orders, and so on
const TOPIC_SCOPE: Record<string, ApiScope> = {
  order: 'read_orders',
  fulfillment: 'read_orders',
  product: 'read_products',
  customer: 'read_customers',
}

function assertTopicsAllowed(token: ApiToken | null, topics: WebhookTopic[] | undefined) {
  if (!token || !topics) return
  const missing = [...new Set(topics.map((t) => TOPIC_SCOPE[t.split('.')[0]!]!))].filter(
    (s) => !hasScope(token.scopes, s),
  )
  if (missing.length) {
    throw new ORPCError('FORBIDDEN', {
      message: `This API token needs the ${missing.join(', ')} scope to subscribe to these events`,
    })
  }
}

// Settings → Webhooks: signed POSTs to the merchant's URLs when orders, products or customers change.
// Apps subscribe with their API token and only see and manage their own subscriptions.
export const webhooks = {
  list: webhookManager
    .route({ method: 'GET', path: '/admin/webhooks' })
    .handler(({ context }) => webhookService.list(context.shop.id, context.token?.id)),
  create: webhookManager
    .route({ method: 'POST', path: '/admin/webhooks' })
    .input(webhookEndpointInput)
    .handler(({ input, context }) => {
      assertTopicsAllowed(context.token, input.topics)
      return webhookService.create(context.shop.id, input, context.token?.id)
    }),
  update: webhookManager
    .route({ method: 'PATCH', path: '/admin/webhooks/{id}' })
    .input(id.extend(webhookEndpointInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) => {
      assertTopicsAllowed(context.token, patch.topics)
      return found(await webhookService.update(context.shop.id, id, patch, context.token?.id))
    }),
  delete: webhookManager
    .route({ method: 'DELETE', path: '/admin/webhooks/{id}' })
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.remove(context.shop.id, input.id, context.token?.id)),
    ),
  rotateSecret: webhookManager
    .route({ method: 'POST', path: '/admin/webhooks/{id}/rotate-secret' })
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.rotateSecret(context.shop.id, input.id, context.token?.id)),
    ),
  sendTest: webhookManager
    .route({ method: 'POST', path: '/admin/webhooks/{id}/test' })
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.sendTest(context.shop.id, input.id, context.token?.id)),
    ),
  deliveries: webhookManager
    .route({ method: 'GET', path: '/admin/webhooks/{endpointId}/deliveries' })
    .input(pagination.extend({ endpointId: z.uuid() }))
    .handler(async ({ input, context }) =>
      found(await webhookService.listDeliveries(context.shop.id, input, context.token?.id)),
    ),
  redeliver: webhookManager
    .route({ method: 'POST', path: '/admin/webhook-deliveries/{id}/redeliver' })
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.redeliver(context.shop.id, input.id, context.token?.id)),
    ),
}
