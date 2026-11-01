// Settings → AI: the provider built into Shopnex (Claude or OpenAI), called with the shop's own API key. Saving
// checks the key can use the model first, so a broken setup never saves. The provider SDKs are only loaded when a
// shop uses one: Shopnex starts (and checks out) the same without them.
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import type { AiBuiltinProvider } from '@shopnex/db/schema'
import { decryptSecret, encryptSecret } from '@shopnex/db/secrets'
import type { AiRunRequest, AiRunResponse } from '@shopnex/marketplace-sdk/ai'
import { AiError } from '../errors'
import type { Settings } from './prompts'

export { GenerationError } from './prompts'

/** What the settings page offers; models are suggestions, any model the key can use works */
export const PROVIDERS = {
  anthropic: {
    name: 'Claude',
    keyHint: 'console.anthropic.com → API keys',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  // Newest in the OpenAI SDK; its tier isn't documented there, so the model stays editable
  openai: { name: 'OpenAI', keyHint: 'platform.openai.com → API keys', models: ['gpt-6.1-sol'] },
} satisfies Record<AiBuiltinProvider, { name: string; keyHint: string; models: string[] }>

const load = (provider: AiBuiltinProvider) => (provider === 'anthropic' ? import('./claude') : import('./openai'))

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function settingsRow(shopId: string) {
  const [row] = await db.select().from(schema.aiSettings).where(eq(schema.aiSettings.shopId, shopId))
  return row ?? null
}

// Never returns the key, only that one is saved (there always is one while it's on)
export async function getSettings(shopId: string) {
  const row = await settingsRow(shopId)
  return {
    settings: row && { provider: row.provider, model: row.model, brandVoice: row.brandVoice },
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id: id as AiBuiltinProvider, ...p })),
  }
}

export type SettingsInput = {
  provider: AiBuiltinProvider
  /** Omit to keep the saved key (only while the provider stays the same) */
  apiKey?: string
  /** Omit for the provider's default */
  model?: string
  brandVoice?: string
}

export async function save(shopId: string, input: SettingsInput) {
  const current = await settingsRow(shopId)
  const sameProvider = current?.provider === input.provider
  const apiKey = input.apiKey || (sameProvider ? decryptSecret(current.apiKey) : null)
  if (!apiKey) throw new AiError('KEY_REQUIRED', `Enter your ${PROVIDERS[input.provider].name} API key`)
  // A model typed for the other provider makes no sense here: start from this provider's default
  const model = input.model || (sameProvider ? current.model : PROVIDERS[input.provider].models[0]!)
  try {
    await (await load(input.provider)).verify(apiKey, model)
  } catch (error) {
    throw new AiError('INVALID_PROVIDER_KEY', `Couldn't use ${model} with this key: ${message(error)}`)
  }
  const values = {
    provider: input.provider,
    model,
    brandVoice: input.brandVoice ?? current?.brandVoice ?? '',
    apiKey: encryptSecret(apiKey),
  }
  await db
    .insert(schema.aiSettings)
    .values({ shopId, ...values })
    .onConflictDoUpdate({ target: schema.aiSettings.shopId, set: { ...values, updatedAt: new Date() } })
  return getSettings(shopId)
}

/** Built-in AI off: the key is deleted */
export async function turnOff(shopId: string) {
  await db.delete(schema.aiSettings).where(eq(schema.aiSettings.shopId, shopId))
  return getSettings(shopId)
}

/** The shop's built-in provider, ready to run; null when it's off */
export async function active(shopId: string) {
  const row = await settingsRow(shopId)
  if (!row) return null
  const settings: Settings = { provider: row.provider, model: row.model, brandVoice: row.brandVoice }
  return {
    name: PROVIDERS[row.provider].name,
    run: async (request: AiRunRequest): Promise<AiRunResponse> =>
      (await load(row.provider)).run(decryptSecret(row.apiKey), settings, request),
  }
}
