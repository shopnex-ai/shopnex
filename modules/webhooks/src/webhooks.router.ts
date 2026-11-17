import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { pagination, createProcedures } from '@shopnex/rpc'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope, ApiToken } from '@shopnex/core/schema'
import * as webhookService from './endpoints'
import { webhookDeliveryOutput, webhookEndpointInput, webhookListItemOutput, webhookOutput } from './webhooks.contract'
import type { WebhookTopic } from './webhooks.schema'

const { webhookManager } = createProcedures()

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// An app may only subscribe to data it can read: order.* needs read_orders, and so on
const TOPIC_SCOPE: Record<string, ApiScope> = {
  order: 'read_orders',
  product: 'read_products',
  inventory: 'read_products',
  customer: 'read_customers',
}

function scopeOf(topic: WebhookTopic): ApiScope {
  const scope = TOPIC_SCOPE[topic.split('.')[0] ?? '']
  if (!scope) throw new Error(`No scope is defined for ${topic}`)
  return scope
}

function assertTopicsAllowed(token: ApiToken | null, topics: WebhookTopic[] | undefined) {
  if (!token || !topics) return
  const missing = [...new Set(topics.map(scopeOf))].filter((s) => !hasScope(token.scopes, s))
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
    .output(z.array(webhookListItemOutput))
    .handler(({ context }) => webhookService.list(context.shop.id, context.token?.id, db)),
  create: webhookManager
    .route({ method: 'POST', path: '/admin/webhooks' })
    .output(webhookOutput)
    .input(webhookEndpointInput)
    .handler(({ input, context }) => {
      assertTopicsAllowed(context.token, input.topics)
      return webhookService.create(context.shop.id, input, context.token?.id, db)
    }),
  update: webhookManager
    .route({ method: 'PATCH', path: '/admin/webhooks/{id}' })
    .output(webhookOutput)
    .input(id.extend(webhookEndpointInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) => {
      assertTopicsAllowed(context.token, patch.topics)
      return found(await webhookService.update(context.shop.id, id, patch, context.token?.id, db))
    }),
  delete: webhookManager
    .route({ method: 'DELETE', path: '/admin/webhooks/{id}' })
    .output(webhookOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.remove(context.shop.id, input.id, context.token?.id, db)),
    ),
  rotateSecret: webhookManager
    .route({ method: 'POST', path: '/admin/webhooks/{id}/rotate-secret' })
    .output(webhookOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.rotateSecret(context.shop.id, input.id, context.token?.id, db)),
    ),
  sendTest: webhookManager
    .route({ method: 'POST', path: '/admin/webhooks/{id}/test' })
    .output(webhookDeliveryOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.sendTest(context.shop.id, input.id, context.token?.id, db)),
    ),
  deliveries: webhookManager
    .route({ method: 'GET', path: '/admin/webhooks/{endpointId}/deliveries' })
    .output(z.object({ items: z.array(webhookDeliveryOutput), total: z.number().int() }))
    .input(pagination.extend({ endpointId: z.uuid() }))
    .handler(async ({ input, context }) =>
      found(await webhookService.listDeliveries(context.shop.id, input, context.token?.id, db)),
    ),
  redeliver: webhookManager
    .route({ method: 'POST', path: '/admin/webhook-deliveries/{id}/redeliver' })
    .output(webhookDeliveryOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      found(await webhookService.redeliver(context.shop.id, input.id, context.token?.id, db)),
    ),
}
