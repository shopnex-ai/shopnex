import { z } from 'zod'
import { marketplaceService } from '@shopnex/apps'
import { paymentService, paymentsAppService } from '@shopnex/payments'
import { paymentsApp, shopManager } from '../../orpc'
import { paymentsAppConfigureInput } from './schemas'

const id = z.object({ id: z.uuid() })

// What an app sees of a session (amounts are Shopnex's: the app reports outcomes, never amounts)
const view = (s: Awaited<ReturnType<typeof paymentService.get>>) => ({
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
// reject the payment / refund sessions Shopnex sends them. App tokens only.
export const paymentsAppApi = {
  configure: paymentsApp
    .route({ method: 'POST', path: '/admin/payments-app/configure' })
    .input(paymentsAppConfigureInput)
    .handler(async ({ input, context }) => {
      const method = await paymentsAppService.configure(context.shop.id, context.appId, input)
      return { id: method.id, name: method.name, gateway: method.gateway, ready: method.ready, active: method.active }
    }),
}

export const paymentSessions = {
  get: paymentsApp
    .route({ method: 'GET', path: '/admin/payment-sessions/{id}' })
    .input(id)
    .handler(async ({ input, context }) => view(await paymentService.get(context.shop.id, context.appId, input.id))),

  // The provider took the payment (or made the refund). Idempotent.
  resolve: paymentsApp
    .route({ method: 'POST', path: '/admin/payment-sessions/{id}/resolve' })
    .input(id.extend({ externalId: z.string().trim().min(1).max(255).optional() }))
    .handler(async ({ input, context }) =>
      view(await paymentService.resolve(context.shop.id, context.appId, input.id, { externalId: input.externalId })),
    ),

  // Declined or failed at the provider. Idempotent; the buyer can try again.
  reject: paymentsApp
    .route({ method: 'POST', path: '/admin/payment-sessions/{id}/reject' })
    .input(id.extend({ reason: z.string().trim().min(1).max(500) }))
    .handler(async ({ input, context }) =>
      view(await paymentService.reject(context.shop.id, context.appId, input.id, { reason: input.reason })),
    ),
}

// Settings → Payments: payments apps this shop could install (Install opens the app, which starts OAuth)
export const paymentApps = {
  available: shopManager
    .route({ method: 'GET', path: '/admin/payment-apps/available' })
    .handler(async ({ context }) => {
      const [instanceUrl, apps] = await Promise.all([
        marketplaceService.instanceUrl(),
        paymentsAppService.availableApps(context.shop.id),
      ])
      return { instanceUrl, apps }
    }),
}
