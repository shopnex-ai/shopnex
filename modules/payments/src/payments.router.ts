import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { marketplaceService } from '@shopnex/apps'
import { db } from '@shopnex/db'
import { createProcedures } from '@shopnex/rpc'
import {
  availableAppsOutput,
  paymentMethodInput,
  paymentMethodOutput,
  paymentSessionOutput,
  paymentsAppConfigureInput,
  paymentsAppOutput,
} from './payments.contract'
import * as paymentMethodService from './payment-methods'
import * as paymentsAppService from './methods'
import type { PaymentSession } from './payments.schema'
import * as paymentService from './sessions'

const { paymentsApp, shopManager } = createProcedures()

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// What an app sees of a session (amounts are ShopNex's: the app reports outcomes, never amounts)
const view = (s: PaymentSession) => ({
  id: s.id,
  kind: s.kind,
  status: s.status,
  orderId: s.orderId,
  amount: { cents: s.amountCents, currency: s.currency },
  externalId: s.externalId,
  errorMessage: s.errorMessage,
  expiresAt: s.expiresAt,
  resolvedAt: s.resolvedAt,
})

// Payments apps (see @shopnex/marketplace-sdk/payments): register the shop's payment method, then resolve or
// reject the payment / refund sessions ShopNex sends them. App tokens only.
export const paymentsAppApi = {
  configure: paymentsApp
    .route({ method: 'POST', path: '/admin/payments-app/configure' })
    .output(paymentsAppOutput)
    .input(paymentsAppConfigureInput)
    .handler(async ({ input, context }) => {
      const method = await paymentsAppService.configure(context.shop.id, context.appId, input, db)
      return { id: method.id, name: method.name, gateway: method.gateway, ready: method.ready, active: method.active }
    }),
}

export const paymentSessions = {
  get: paymentsApp
    .route({ method: 'GET', path: '/admin/payment-sessions/{id}' })
    .output(paymentSessionOutput)
    .input(id)
    .handler(async ({ input, context }) =>
      view(await paymentService.get(context.shop.id, context.appId, input.id, db)),
    ),

  // The provider took the payment (or made the refund). Idempotent.
  resolve: paymentsApp
    .route({ method: 'POST', path: '/admin/payment-sessions/{id}/resolve' })
    .output(paymentSessionOutput)
    .input(id.extend({ externalId: z.string().trim().min(1).max(255).optional() }))
    .handler(async ({ input, context }) =>
      view(
        await paymentService.resolve(context.shop.id, context.appId, input.id, { externalId: input.externalId }, db),
      ),
    ),

  // One attempt failed (card declined…) but the buyer can retry on the same page: the session stays open.
  attemptFailed: paymentsApp
    .route({ method: 'POST', path: '/admin/payment-sessions/{id}/attempt-failed' })
    .output(paymentSessionOutput)
    .input(id.extend({ reason: z.string().trim().min(1).max(500) }))
    .handler(async ({ input, context }) =>
      view(await paymentService.attemptFailed(context.shop.id, context.appId, input.id, { reason: input.reason }, db)),
    ),

  // Declined or failed at the provider. Idempotent; the buyer can try again.
  reject: paymentsApp
    .route({ method: 'POST', path: '/admin/payment-sessions/{id}/reject' })
    .output(paymentSessionOutput)
    .input(id.extend({ reason: z.string().trim().min(1).max(500) }))
    .handler(async ({ input, context }) =>
      view(await paymentService.reject(context.shop.id, context.appId, input.id, { reason: input.reason }, db)),
    ),
}

// Settings → Payments: payments apps this shop could install (Install opens the app, which starts OAuth)
export const paymentApps = {
  available: shopManager
    .route({ method: 'GET', path: '/admin/payment-apps/available' })
    .output(availableAppsOutput)
    .handler(async ({ context }) => {
      const [instanceUrl, apps] = await Promise.all([
        marketplaceService.instanceUrl(),
        paymentsAppService.availableApps(context.shop.id, db),
      ])
      return { instanceUrl, apps }
    }),
}

// Settings → Payments: manual payment methods (bank transfer, cash on delivery…)
export const paymentMethods = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/payment-methods' })
    .output(z.array(paymentMethodOutput))
    .handler(({ context }) => paymentMethodService.list(context.shop.id, {}, db)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/payment-methods' })
    .output(paymentMethodOutput)
    .input(paymentMethodInput)
    .handler(({ input, context }) => paymentMethodService.create(context.shop.id, input, db)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/payment-methods/{id}' })
    .output(paymentMethodOutput)
    .input(id.extend(paymentMethodInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await paymentMethodService.update(context.shop.id, id, patch, db)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/payment-methods/{id}' })
    .output(paymentMethodOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await paymentMethodService.remove(context.shop.id, input.id, db))),
}
