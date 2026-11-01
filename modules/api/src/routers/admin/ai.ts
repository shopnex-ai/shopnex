import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { AI_FEEDBACK, aiProviderService, aiService, aiSettingsService } from '@shopnex/ai'
import { hasScope } from '@shopnex/tenancy'
import { adminOrToken, aiApp, scoped, shopManager } from '../../orpc'
import { aiAppConfigureInput, aiRunInput, aiSettingsInput } from './schemas'

// AI apps (see @shopnex/marketplace-sdk/ai): register the capabilities they provide for the shop. App tokens only.
export const aiAppApi = {
  configure: aiApp
    .route({ method: 'POST', path: '/admin/ai-app/configure' })
    .input(aiAppConfigureInput)
    .handler(async ({ input, context }) => {
      const rows = await aiProviderService.configure(context.shop.id, context.appId, input)
      return { capabilities: Object.fromEntries(rows.map((r) => [r.capability, r.url])) }
    }),
}

// Whoever may read the product or collection may ask for a suggestion about it. Saving it is a separate, ordinary
// write (e.g. PATCH /admin/products/{id}). Pages are staff only, like the pages API.
const productReader = scoped('read_products')

export const ai = {
  // What staff can use: capabilities with who provides them (built-in AI first, then installed apps)
  capabilities: adminOrToken
    .route({ method: 'GET', path: '/admin/ai/capabilities' })
    .handler(({ context }) => aiProviderService.available(context.shop.id)),

  run: adminOrToken
    .route({ method: 'POST', path: '/admin/ai/run' })
    .input(aiRunInput)
    .handler(({ input, context }) => {
      if (context.token && (input.capability === 'page.content' || !hasScope(context.token.scopes, 'read_products'))) {
        throw new ORPCError('FORBIDDEN', {
          message:
            input.capability === 'page.content'
              ? 'Page copy is for staff only'
              : 'This API token needs the read_products scope',
        })
      }
      return aiService.run(context.shop.id, {
        capability: input.capability,
        subjectId: 'productId' in input ? input.productId : 'collectionId' in input ? input.collectionId : input.pageId,
        input: input.input,
        providerId: input.providerId,
        userId: context.userId,
      })
    }),

  // Staff used the suggestion (accepted) or dismissed it (rejected)
  feedback: productReader
    .route({ method: 'POST', path: '/admin/ai/generations/{id}/feedback' })
    .input(z.object({ id: z.uuid(), feedback: z.enum(AI_FEEDBACK) }))
    .handler(({ input, context }) => aiService.feedback(context.shop.id, input.id, input.feedback)),
}

// Settings → AI: built-in AI with the shop's own key. Owners and admins only; the key is write-only.
export const aiSettings = {
  get: shopManager
    .route({ method: 'GET', path: '/admin/ai/settings' })
    .handler(({ context }) => aiSettingsService.getSettings(context.shop.id)),
  // Checks the key can use the model first and fails if the provider refuses it
  update: shopManager
    .route({ method: 'PUT', path: '/admin/ai/settings' })
    .input(aiSettingsInput)
    .handler(({ input, context }) =>
      aiSettingsService.save(context.shop.id, {
        ...input,
        apiKey: input.apiKey || undefined,
        model: input.model || undefined,
      }),
    ),
  turnOff: shopManager
    .route({ method: 'DELETE', path: '/admin/ai/settings' })
    .handler(({ context }) => aiSettingsService.turnOff(context.shop.id)),
}
