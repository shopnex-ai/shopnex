// This instance's side of the app marketplace (the marketplace itself is apps/marketplace): connect once,
// then sync the catalog into the local `apps` and `marketplace_themes` tables (the Theme Store) and report
// marketplace-app installations back.
// Business logic only; super admins drive it from Admin → Apps.
import { randomBytes } from 'node:crypto'
import { and, eq, isNotNull, isNull, notInArray } from 'drizzle-orm'
import { ORPCError, createMarketplaceClient } from '@shopnex/marketplace-sdk'
import { SCOPES, type Scope } from '@shopnex/marketplace-sdk/contract'
import { ThemeDocument } from '@shopnex/storefront-sdk/theme'
import { db, schema, type Tx } from '@shopnex/db'
import { normalizeScopes } from '@shopnex/tenancy'
import { AppError } from './errors'

const CONNECTION_ID = 'default'
// Catalog + installations sync interval (the worker also runs right after connecting)
const SYNC_INTERVAL_MS = 10 * 60_000

export async function getConnection() {
  const [connection] = await db
    .select()
    .from(schema.marketplaceConnection)
    .where(eq(schema.marketplaceConnection.id, CONNECTION_ID))
  return connection ?? null
}

// Connected = the marketplace issued us a key
async function requireConnected() {
  const connection = await getConnection()
  if (!connection?.instanceKey) throw new AppError('MARKETPLACE_NOT_CONNECTED', 'Not connected to a marketplace')
  return { ...connection, instanceKey: connection.instanceKey }
}

const client = (c: { marketplaceUrl: string; instanceKey?: string | null }) =>
  createMarketplaceClient({ baseUrl: c.marketplaceUrl, instanceKey: c.instanceKey ?? undefined })

// This instance's public origin as apps see it: sent to apps as `instance` (install link, OAuth redirect)
export async function instanceUrl() {
  const connection = await getConnection()
  return connection?.publicUrl ?? new URL(process.env.APP_URL ?? 'http://localhost:3000').origin
}

// Served at GET /api/v1/marketplace/challenge while a connect is in flight
export async function pendingChallenge() {
  return (await getConnection())?.pendingChallenge ?? null
}

/**
 * Publishes a challenge, asks the marketplace to verify it at `publicUrl`, stores the instance key, then syncs.
 * `publicUrl` must be reachable from the marketplace (and from apps).
 */
export async function connect(input: { marketplaceUrl: string; publicUrl: string; name?: string }) {
  const marketplaceUrl = new URL(input.marketplaceUrl).origin
  const publicUrl = new URL(input.publicUrl).origin
  const challenge = randomBytes(24).toString('base64url')
  const pending = {
    marketplaceUrl,
    publicUrl,
    pendingChallenge: challenge,
    instanceId: null,
    instanceKey: null,
    connectedAt: null,
  }
  await db
    .insert(schema.marketplaceConnection)
    .values({ id: CONNECTION_ID, ...pending })
    .onConflictDoUpdate({ target: schema.marketplaceConnection.id, set: pending })
  try {
    const { instanceId, instanceKey } = await client({ marketplaceUrl }).instances.connect({
      url: publicUrl,
      name: input.name,
      challenge,
    })
    await db
      .update(schema.marketplaceConnection)
      .set({ instanceId, instanceKey, connectedAt: new Date(), pendingChallenge: null, lastSyncError: null })
      .where(eq(schema.marketplaceConnection.id, CONNECTION_ID))
  } catch (error) {
    await db.delete(schema.marketplaceConnection).where(eq(schema.marketplaceConnection.id, CONNECTION_ID))
    // e.g. INSTANCE_UNVERIFIED: the marketplace couldn't fetch our challenge from publicUrl
    const message = error instanceof ORPCError ? error.message : `Couldn't reach the marketplace at ${marketplaceUrl}`
    throw new AppError('MARKETPLACE_CONNECT_FAILED', message)
  }
  await sync()
  return getConnection()
}

/**
 * Leaves the marketplace. Marketplace apps stay installed and keep working (their tokens are local), but
 * they can't be newly installed and the marketplace stops vouching for these installs.
 */
export async function disconnect() {
  const connection = await getConnection()
  if (!connection) return null
  if (connection.instanceKey) {
    await client(connection)
      .instances.disconnect()
      .catch((error) => console.error('[marketplace] disconnect:', error))
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.marketplaceConnection).where(eq(schema.marketplaceConnection.id, CONNECTION_ID))
    // Copies shops already added stay in their libraries
    await tx.delete(schema.marketplaceThemes)
    await tx
      .update(schema.apps)
      .set({ delistedAt: new Date() })
      .where(and(eq(schema.apps.source, 'marketplace'), isNull(schema.apps.delistedAt)))
  })
  return connection
}

/**
 * Pulls the catalog into `apps` (upsert; apps gone from it are delisted) and `marketplace_themes` (replaced),
 * then reports installations.
 */
export async function sync() {
  const connection = await requireConnected()
  try {
    const { apps, themes } = await client(connection).catalog.list()
    await db.transaction(async (tx) => {
      await syncThemes(tx, themes)
      for (const app of apps) {
        const fields = {
          name: app.name,
          tagline: app.tagline,
          description: app.description,
          iconUrl: app.iconUrl,
          developerName: app.developerName,
          listingUrl: app.listingUrl,
          appUrl: app.appUrl,
          redirectUrls: app.redirectUrls,
          scopes: normalizeScopes(app.scopes),
          clientId: app.clientId,
          publicKey: app.publicKey,
          delistedAt: null,
          updatedAt: new Date(),
        }
        await tx
          .insert(schema.apps)
          .values({ ...fields, source: 'marketplace', marketplaceAppId: app.id })
          .onConflictDoUpdate({ target: schema.apps.marketplaceAppId, set: fields })
      }
      await tx
        .update(schema.apps)
        .set({ delistedAt: new Date() })
        .where(
          and(
            eq(schema.apps.source, 'marketplace'),
            isNull(schema.apps.delistedAt),
            apps.length
              ? notInArray(
                  schema.apps.marketplaceAppId,
                  apps.map((a) => a.id),
                )
              : undefined,
          ),
        )
    })
    await reportInstallations()
    await db
      .update(schema.marketplaceConnection)
      .set({ lastSyncAt: new Date(), lastSyncError: null })
      .where(eq(schema.marketplaceConnection.id, CONNECTION_ID))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(schema.marketplaceConnection)
      .set({ lastSyncError: message })
      .where(eq(schema.marketplaceConnection.id, CONNECTION_ID))
    throw error
  }
}

// The Theme Store's styles: the catalog's, minus documents that aren't valid (a newer format, a bad vendor
// upload). Styles gone from the catalog are removed; shops' copies of them stay.
// As the client returns them (dates arrive as JSON strings)
type CatalogThemes = Awaited<ReturnType<ReturnType<typeof client>['catalog']['list']>>['themes']

async function syncThemes(tx: Tx, themes: CatalogThemes) {
  const rows = themes.flatMap((theme) => {
    const document = ThemeDocument.safeParse(theme.document)
    if (!document.success) {
      console.warn(`[marketplace] skipped theme style ${theme.slug}: invalid document`)
      return []
    }
    return [
      {
        id: theme.id,
        slug: theme.slug,
        name: theme.name,
        tagline: theme.tagline,
        description: theme.description,
        developerName: theme.developerName,
        baseThemeId: theme.baseThemeId,
        screenshotUrl: theme.screenshotUrl,
        document: document.data,
        listingUrl: theme.listingUrl,
        updatedAt: new Date(theme.updatedAt),
        syncedAt: new Date(),
      },
    ]
  })
  for (const row of rows) {
    await tx
      .insert(schema.marketplaceThemes)
      .values(row)
      .onConflictDoUpdate({ target: schema.marketplaceThemes.id, set: row })
  }
  await tx.delete(schema.marketplaceThemes).where(
    rows.length
      ? notInArray(
          schema.marketplaceThemes.id,
          rows.map((r) => r.id),
        )
      : undefined,
  )
}

/** Sends the full list of live marketplace-app installations (every shop). Call after install/uninstall. */
export async function reportInstallations() {
  const connection = await requireConnected()
  const rows = await db
    .select({ installation: schema.appInstallations, marketplaceAppId: schema.apps.marketplaceAppId })
    .from(schema.appInstallations)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.appInstallations.appId))
    .where(and(isNull(schema.appInstallations.uninstalledAt), isNotNull(schema.apps.marketplaceAppId)))
  await client(connection).installations.sync({
    installations: rows.map((r) => ({
      appId: r.marketplaceAppId!,
      shopId: r.installation.shopId,
      // The marketplace knows its own scopes only (payment session scopes are instance-only for now)
      scopes: r.installation.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)),
      installedAt: r.installation.installedAt,
    })),
  })
}

/**
 * After an install/uninstall: tell the marketplace now. Never throws and gives up after 5s; a failed report
 * heals on the next sync. Await it where the app is about to verify the install (token exchange).
 */
export async function reportInstallationsSoon() {
  try {
    await Promise.race([
      reportInstallations(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5_000)),
    ])
  } catch (error) {
    if (error instanceof AppError && error.code === 'MARKETPLACE_NOT_CONNECTED') return
    console.error('[marketplace] report installations:', error instanceof Error ? error.message : error)
  }
}

const globalForSync = globalThis as unknown as { marketplaceSync?: NodeJS.Timeout }

/** Periodic sync while connected. Started once per process (dev hot reloads reuse it). */
export function startMarketplaceSync() {
  if (globalForSync.marketplaceSync) return
  const tick = async () => {
    if (!(await getConnection())?.instanceKey) return
    await sync().catch((error) => console.error('[marketplace] sync:', error instanceof Error ? error.message : error))
  }
  globalForSync.marketplaceSync = setInterval(tick, SYNC_INTERVAL_MS)
  setTimeout(tick, 5_000)
}
