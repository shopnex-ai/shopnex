// AI apps register the capabilities they provide for a shop (like payments apps register their method). The
// app's own setup decides when: e.g. only once the merchant has entered a provider key. Uninstalling the app
// removes them (see appService.uninstall).
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { AI_CAPABILITIES, type AiCapability } from '@shopnex/marketplace-sdk/ai'
import { AiError } from './errors'

export type ConfigureInput = {
  /** Capability → the URL that receives its signed AiRunRequests. Capabilities left out are removed. */
  capabilities: Partial<Record<AiCapability, string>>
}

const origin = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Replaces what the app provides in this shop. URLs must be on the app's own origin (its registered app URL),
 * so an app can't point Shopnex at someone else's server.
 */
export async function configure(shopId: string, appId: string, input: ConfigureInput) {
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId))
  if (!app) throw new AiError('NOT_AN_AI_APP', 'Only an installed app can provide AI capabilities')
  const appOrigin = origin(app.appUrl)
  const entries = Object.entries(input.capabilities).filter((e): e is [AiCapability, string] => Boolean(e[1]))
  for (const [, url] of entries) {
    if (!appOrigin || origin(url) !== appOrigin) {
      throw new AiError('INVALID_PROVIDER_URL', `Capability URLs must be on the app's origin (${appOrigin})`)
    }
  }
  const own = and(eq(schema.aiProviders.shopId, shopId), eq(schema.aiProviders.appId, appId))
  return db.transaction(async (tx) => {
    const names = entries.map(([capability]) => capability)
    await tx
      .delete(schema.aiProviders)
      .where(names.length ? and(own, notInArray(schema.aiProviders.capability, names)) : own)
    for (const [capability, url] of entries) {
      await tx
        .insert(schema.aiProviders)
        .values({ shopId, appId, capability, url })
        .onConflictDoUpdate({
          target: [schema.aiProviders.shopId, schema.aiProviders.appId, schema.aiProviders.capability],
          set: { url, updatedAt: new Date() },
        })
    }
    return tx.select().from(schema.aiProviders).where(own).orderBy(asc(schema.aiProviders.capability))
  })
}

/** Providers of apps still installed in the shop, oldest first (the first one is the default) */
export async function providers(shopId: string, capabilities: readonly string[] = AI_CAPABILITIES) {
  return db
    .select({
      capability: schema.aiProviders.capability,
      url: schema.aiProviders.url,
      app: { id: schema.apps.id, name: schema.apps.name, iconUrl: schema.apps.iconUrl },
    })
    .from(schema.aiProviders)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.aiProviders.appId))
    .innerJoin(
      schema.appInstallations,
      and(
        eq(schema.appInstallations.appId, schema.aiProviders.appId),
        eq(schema.appInstallations.shopId, schema.aiProviders.shopId),
        isNull(schema.appInstallations.uninstalledAt),
      ),
    )
    .where(and(eq(schema.aiProviders.shopId, shopId), inArray(schema.aiProviders.capability, [...capabilities])))
    .orderBy(asc(schema.aiProviders.createdAt), asc(schema.apps.name))
}

/** What staff can use in this shop: each available capability with the apps that provide it */
export async function available(shopId: string) {
  const rows = await providers(shopId)
  return AI_CAPABILITIES.flatMap((capability) => {
    const apps = rows.filter((r) => r.capability === capability).map((r) => r.app)
    return apps.length ? [{ capability, apps }] : []
  })
}

/** Apps that can provide AI capabilities (allowed write_ai_capabilities) and aren't installed in this shop yet */
export async function availableApps(shopId: string) {
  const rows = await db
    .select({ app: schema.apps, installationId: schema.appInstallations.id })
    .from(schema.apps)
    .leftJoin(
      schema.appInstallations,
      and(
        eq(schema.appInstallations.appId, schema.apps.id),
        eq(schema.appInstallations.shopId, shopId),
        isNull(schema.appInstallations.uninstalledAt),
      ),
    )
    .where(and(sql`'write_ai_capabilities' = any(${schema.apps.scopes})`, isNull(schema.apps.delistedAt)))
    .orderBy(asc(schema.apps.name))
  return rows
    .filter((r) => r.installationId === null)
    .map(({ app }) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      iconUrl: app.iconUrl,
      appUrl: app.appUrl,
      clientId: app.clientId,
      redirectUrls: app.redirectUrls,
    }))
}
