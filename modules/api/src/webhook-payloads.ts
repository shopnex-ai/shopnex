// What each webhook topic carries in `data`: the resource as the admin API returns it. The docs build reads this (see reference.ts) to list the
// fields, so those pages cannot drift from the code. Not used at runtime.
import { z } from 'zod'
import { customerOutput } from '@shopnex/customers/contract'
import { productOutput } from '@shopnex/catalog/contract'
import { orderDetailOutput } from '@shopnex/orders/contract'
import { customerErasedOutput } from '@shopnex/privacy/contract'
import type { WebhookTopic } from '@shopnex/webhooks/schema'

// `inventory.updated`: one variant's stock after the change (null when an edit stopped tracking it)
const inventoryEventOutput = z.object({
  variantId: z.string(),
  productId: z.string(),
  sku: z.string().nullable(),
  inventoryQuantity: z.number().int().nullable(),
  // After minus before; null when either side was untracked
  change: z.number().int().nullable(),
  reason: z.enum(['order', 'restock', 'edit']),
  updatedAt: z.date(),
})

// The `data` of each webhook topic: the resource as the admin API returns it. The docs list its fields.
export const webhookPayloads: Record<WebhookTopic, z.ZodType> = {
  'order.created': orderDetailOutput,
  'order.paid': orderDetailOutput,
  'order.fulfilled': orderDetailOutput,
  'order.cancelled': orderDetailOutput,
  'order.updated': orderDetailOutput,
  'product.created': productOutput,
  'product.updated': productOutput,
  'inventory.updated': inventoryEventOutput,
  'customer.created': customerOutput,
  'customer.updated': customerOutput,
  'customer.erased': customerErasedOutput,
}
