// Who provides AI capabilities in a shop: built-in AI (Settings → AI) provides every capability; installed apps
// register the ones they provide (like payments apps register their method), when their own setup decides.
// Uninstalling an app removes them (see appService.uninstall).
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { AI_CAPABILITIES, type AiCapability } from '@shopnex/marketplace-sdk/ai'
import * as builtin from './builtin'
import { AiError } from './ai.errors'
import { aiProviders } from './ai.schema'
import { appInstallations } from '@shopnex/apps/schema'
import { apps } from '@shopnex/core/schema'

/** The provider id of built-in AI (apps go by their app id) */
export const BUILTIN = 'builtin'

export interface ConfigureInput {
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
 * so an app can't point ShopNex at someone else's server.
 */
export async function configure(shopId: string, appId: string, input: ConfigureInput, conn: Conn) {
  const [app] = await conn.select().from(apps).where(eq(apps.id, appId))
  if (!app) throw new AiError('NOT_AN_AI_APP', 'Only an installed app can provide AI capabilities')
  const appOrigin = origin(app.appUrl)
  const entries = Object.entries(input.capabilities).filter((e): e is [AiCapability, string] => Boolean(e[1]))
  for (const [, url] of entries) {
    if (!appOrigin || origin(url) !== appOrigin) {
      throw new AiError('INVALID_PROVIDER_URL', `Capability URLs must be on the app's origin (${String(appOrigin)})`)
    }
  }
  const own = and(eq(aiProviders.shopId, shopId), eq(aiProviders.appId, appId))
  return conn.transaction(async (tx) => {
    const names = entries.map(([capability]) => capability)
    await tx.delete(aiProviders).where(names.length ? and(own, notInArray(aiProviders.capability, names)) : own)
    for (const [capability, url] of entries) {
      await tx
        .insert(aiProviders)
        .values({ shopId, appId, capability, url })
        .onConflictDoUpdate({
          target: [aiProviders.shopId, aiProviders.appId, aiProviders.capability],
          set: { url, updatedAt: new Date() },
        })
    }
    return tx.select().from(aiProviders).where(own).orderBy(asc(aiProviders.capability))
  })
}

/** Providers of apps still installed in the shop, oldest first (the first one is the default) */
export async function providers(shopId: string, capabilities: readonly string[] | undefined, conn: Conn) {
  capabilities ??= AI_CAPABILITIES
  return conn
    .select({
      capability: aiProviders.capability,
      url: aiProviders.url,
      app: { id: apps.id, name: apps.name, iconUrl: apps.iconUrl },
    })
    .from(aiProviders)
    .innerJoin(apps, eq(apps.id, aiProviders.appId))
    .innerJoin(
      appInstallations,
      and(
        eq(appInstallations.appId, aiProviders.appId),
        eq(appInstallations.shopId, aiProviders.shopId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
    .where(and(eq(aiProviders.shopId, shopId), inArray(aiProviders.capability, [...capabilities])))
    .orderBy(asc(aiProviders.createdAt), asc(apps.name))
}

/** What staff can use in this shop: each available capability with who provides it, the default first */
export async function available(shopId: string, conn: Conn) {
  const [own, rows] = await Promise.all([builtin.active(shopId, conn), providers(shopId, undefined, conn)])
  const builtIn = own ? [{ id: BUILTIN, name: own.name, iconUrl: null }] : []
  return AI_CAPABILITIES.flatMap((capability) => {
    const list = [...builtIn, ...rows.filter((r) => r.capability === capability).map((r) => r.app)]
    return list.length ? [{ capability, providers: list }] : []
  })
}
