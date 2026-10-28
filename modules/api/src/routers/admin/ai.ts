import { z } from 'zod'
import { AI_FEEDBACK, aiProviderService, aiService } from '@shopnex/ai'
import { marketplaceService } from '@shopnex/apps'
import { adminOrToken, aiApp, scoped, shopManager } from '../../orpc'
import { aiAppConfigureInput, aiRunInput } from './schemas'

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

// Every capability has a product subject so far: whoever may read the product may ask for a suggestion. Saving
// it is a separate, ordinary write (e.g. PATCH /admin/products/{id}).
const productReader = scoped('read_products')

export const ai = {
  // What staff can use: capabilities with at least one installed app providing them
  capabilities: adminOrToken
    .route({ method: 'GET', path: '/admin/ai/capabilities' })
    .handler(({ context }) => aiProviderService.available(context.shop.id)),

  run: productReader
    .route({ method: 'POST', path: '/admin/ai/run' })
    .input(aiRunInput)
    .handler(({ input, context }) =>
      aiService.run(context.shop.id, {
        capability: input.capability,
        subjectId: input.productId,
        input: input.input,
        appId: input.appId,
        userId: context.userId,
      }),
    ),

  // Admin → Apps: AI apps this shop could install (Install opens the consent screen, or the app's OAuth)
  availableApps: shopManager.route({ method: 'GET', path: '/admin/ai/apps/available' }).handler(async ({ context }) => {
    const [instanceUrl, apps] = await Promise.all([
      marketplaceService.instanceUrl(),
      aiProviderService.availableApps(context.shop.id),
    ])
    return { instanceUrl, apps }
  }),

  // Staff used the suggestion (accepted) or dismissed it (rejected)
  feedback: productReader
    .route({ method: 'POST', path: '/admin/ai/generations/{id}/feedback' })
    .input(z.object({ id: z.uuid(), feedback: z.enum(AI_FEEDBACK) }))
    .handler(({ input, context }) => aiService.feedback(context.shop.id, input.id, input.feedback)),
}
