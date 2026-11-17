// The shapes of this module's API: what the AI routes take and answer. Plain Zod, no oRPC or server code.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { AI_CAPABILITIES, aiCapabilities, type AiCapability } from '@shopnex/marketplace-sdk/ai'
import { AI_BUILTIN_PROVIDERS, aiGenerations, aiSettings } from './ai.schema'

// AI capabilities (see @shopnex/marketplace-sdk/ai)
export const aiAppConfigureInput = z.object({
  /** Capability → URL receiving its signed AiRunRequests (on the app's own origin). Left out: not provided. */
  capabilities: z.partialRecord(z.enum(AI_CAPABILITIES), z.url({ protocol: /^https?$/ })),
})

// What a capability is about: the product or collection to read (a page being written may not exist yet)
const aiRunFor = <C extends AiCapability, S extends z.ZodRawShape>(capability: C, subject: S) =>
  z.object({
    capability: z.literal(capability),
    ...subject,
    /** Who should answer: "builtin" or an app's id (GET /admin/ai/capabilities); default: the first */
    providerId: z.union([z.literal('builtin'), z.uuid()]).optional(),
    input: aiCapabilities[capability].input.optional(),
  })

const product = { productId: z.uuid() }
const collection = { collectionId: z.uuid() }
const page = { pageId: z.uuid().optional() }

// One entry per capability, so each one's input is typed
export const aiRunInput = z.discriminatedUnion('capability', [
  aiRunFor('product.description', product),
  aiRunFor('product.seo', product),
  aiRunFor('product.image_alt', product),
  aiRunFor('product.classify', product),
  aiRunFor('collection.description', collection),
  aiRunFor('collection.seo', collection),
  aiRunFor('page.content', page),
])

// Settings → AI: built-in AI with the shop's own key
export const aiSettingsInput = z.object({
  provider: z.enum(AI_BUILTIN_PROVIDERS),
  /** Empty keeps the saved key (same provider only) */
  apiKey: z.string().trim().max(500).optional(),
  /** Empty for the provider's default */
  model: z.string().trim().max(100).optional(),
  brandVoice: z.string().trim().max(1000).optional(),
})

// AI
const aiCapability = z.enum(AI_CAPABILITIES)
const providerRef = z.object({ id: z.string(), name: z.string() })
export const aiAppConfigureOutput = z.object({ capabilities: z.record(z.string(), z.string()) })
export const aiCapabilitiesOutput = z.array(
  z.object({ capability: aiCapability, providers: z.array(providerRef.extend({ iconUrl: z.string().nullable() })) }),
)
const aiOutputs = Object.values(aiCapabilities).map((c) => c.output) as unknown as [
  z.ZodType,
  z.ZodType,
  ...z.ZodType[],
]
export const aiRunOutput = z.object({
  id: z.uuid(),
  capability: aiCapability,
  provider: providerRef,
  output: z.union(aiOutputs),
  usage: z
    .object({
      model: z.string().optional(),
      inputTokens: z.number().int().optional(),
      outputTokens: z.number().int().optional(),
    })
    .nullable(),
})
export const aiFeedbackOutput = createSelectSchema(aiGenerations, {
  feedback: z.enum(['rejected', 'accepted']).nullable(),
}).pick({
  id: true,
  feedback: true,
})
export const aiSettingsOutput = z.object({
  settings: createSelectSchema(aiSettings, { provider: z.enum(AI_BUILTIN_PROVIDERS) })
    .pick({ provider: true, model: true, brandVoice: true, enabled: true })
    .nullable(),
  providers: z.array(
    z.object({ id: z.enum(AI_BUILTIN_PROVIDERS), name: z.string(), keyHint: z.string(), models: z.array(z.string()) }),
  ),
})
