// Reads and writes of the shop's own provider credentials (Paystack, BobGo). The secret is sealed before it is
// stored and only opened by integrationSecret: nothing here returns or logs the plain key.
import { and, eq } from 'drizzle-orm'
import { db } from './index'
import { type IntegrationProvider, shopIntegrations } from './schema'
import { decryptSecret, encryptSecret } from './secrets'

export type IntegrationSummary = {
  shopId: string
  provider: IntegrationProvider
  config: unknown
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type IntegrationInput = {
  /** Omit or leave empty to keep the saved secret */
  secret?: string
  /** Omit to keep the saved config */
  config?: object
  /** Omit to keep the saved state */
  enabled?: boolean
}

const where = (shopId: string, provider: IntegrationProvider) =>
  and(eq(shopIntegrations.shopId, shopId), eq(shopIntegrations.provider, provider))

// Never selects the secret column
export async function getIntegration(
  shopId: string,
  provider: IntegrationProvider,
): Promise<IntegrationSummary | null> {
  const [row] = await db
    .select({
      shopId: shopIntegrations.shopId,
      provider: shopIntegrations.provider,
      config: shopIntegrations.config,
      enabled: shopIntegrations.enabled,
      createdAt: shopIntegrations.createdAt,
      updatedAt: shopIntegrations.updatedAt,
    })
    .from(shopIntegrations)
    .where(where(shopId, provider))
  return row ?? null
}

export async function saveIntegration(
  shopId: string,
  provider: IntegrationProvider,
  input: IntegrationInput,
): Promise<void> {
  const [current] = await db
    .select({ secret: shopIntegrations.secret, config: shopIntegrations.config, enabled: shopIntegrations.enabled })
    .from(shopIntegrations)
    .where(where(shopId, provider))
  // The secret column is required, so the first save must bring one
  const secret = input.secret ? encryptSecret(input.secret) : current?.secret
  if (!secret) throw new Error(`An API key is required for the first ${provider} setup`)
  const config = input.config ?? (current?.config as object | undefined) ?? {}
  const enabled = input.enabled ?? current?.enabled ?? true
  const values = { shopId, provider, secret, config, enabled }
  await db
    .insert(shopIntegrations)
    .values(values)
    .onConflictDoUpdate({
      target: [shopIntegrations.shopId, shopIntegrations.provider],
      set: { secret, config, enabled, updatedAt: new Date() },
    })
}

export async function deleteIntegration(shopId: string, provider: IntegrationProvider): Promise<void> {
  await db.delete(shopIntegrations).where(where(shopId, provider))
}

// Null when the row is missing or switched off: a disabled provider must not be called with the key
export async function integrationSecret(shopId: string, provider: IntegrationProvider): Promise<string | null> {
  const [row] = await db
    .select({ secret: shopIntegrations.secret, enabled: shopIntegrations.enabled })
    .from(shopIntegrations)
    .where(where(shopId, provider))
  if (!row?.enabled) return null
  return decryptSecret(row.secret)
}

export async function integrationConfig<T>(shopId: string, provider: IntegrationProvider): Promise<T | null> {
  const [row] = await db
    .select({ config: shopIntegrations.config })
    .from(shopIntegrations)
    .where(where(shopId, provider))
  return (row?.config as T | undefined) ?? null
}
