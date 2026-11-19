// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Registry (super admins) → the shop owner/admin consents → installation backed by an API token. Installing
// happens right in the admin (managed install) or, for apps with redirect URLs, through an OAuth authorization
// code. Apps authenticate with client assertions signed by their own key (we only store the public half) and
// get access tokens with one of three grants:
//   authorization_code  code from the consent screen → long-lived token (sk_…), for apps that store it
//   token_exchange      session token from the embedded admin page → 1-hour access token
//   client_credentials  shop_id of a live installation → 1-hour access token (background work)
// Codes are only stored as SHA-256 hashes.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { db, type Conn } from '@shopnex/db'
import { appUninstalled } from './apps.hooks'
import {
  decodeJwt,
  generateKeyPair,
  importPublicKey,
  signJwt,
  verifyClientAssertion,
  verifyJwt,
} from '@shopnex/marketplace-sdk/keys'
import { APP_INSTALLED_PATH, signLifecycleRequest, type AppInstalledRequest } from '@shopnex/marketplace-sdk/lifecycle'
import { SESSION_TOKEN_TYP, signSessionToken, type SessionTokenClaims } from '@shopnex/marketplace-sdk/session-token'
import { normalizeScopes } from '@shopnex/core/scopes'
import { mintToken, revokeTokenById, touchToken, type ApiToken } from '@shopnex/tenancy'
import { AppError } from './apps.errors'
import { instanceSigner, ownKey } from './keys'
import { rememberInternalUrl, serverUrl } from './internal-url'
import { instanceUrl, reportInstallationsSoon } from './marketplace'
import { log } from './log'
import {
  appAuthorizationCodes,
  appData,
  appInstallations,
  appStorefrontScripts,
  type AppInstallation,
} from './apps.schema'
import { API_SCOPES, type ApiScope, apiTokens, type App, apps, shops } from '@shopnex/core/schema'

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')
const random = (bytes: number) => randomBytes(bytes).toString('base64url')

export const CODE_TTL_MS = 10 * 60_000
const ACCESS_TOKEN_TTL_S = 3600
const ACCESS_TOKEN_TYP = 'at+jwt'

export type AppInput = {
  name: string
  description?: string | null
  iconUrl?: string | null
  appUrl: string
  redirectUrls: string[]
  scopes: ApiScope[]
}

export function publicApp(app: App) {
  return { ...app, managed: app.redirectUrls.length === 0 }
}

// --- registry (super admins) ---

// A new key pair: the private key is only in this return value (the app keeps it as SHOPNEX_APP_KEY)
export async function registerApp(input: AppInput, createdById: string | null) {
  const { privateKey, publicKey } = await generateKeyPair()
  const [app] = await db
    .insert(apps)
    .values({
      ...input,
      scopes: normalizeScopes(input.scopes),
      clientId: 'app_' + random(12),
      publicKey,
      createdById,
    })
    .returning()
  return { app: publicApp(app!), privateKey }
}

// Registry functions only touch custom apps; marketplace apps are edited by their vendor on the marketplace
const customApp = (id: string) => and(eq(apps.id, id), eq(apps.source, 'custom'))

export async function listApps() {
  const rows = await db.select().from(apps).where(eq(apps.source, 'custom')).orderBy(asc(apps.name))
  return rows.map(publicApp)
}

/** The client id of an installed app by its row id (what apps call themselves), or null */
export async function clientIdOf(id: string) {
  const [app] = await db.select({ clientId: apps.clientId }).from(apps).where(eq(apps.id, id))
  return app?.clientId ?? null
}

export async function getApp(id: string) {
  const [app] = await db.select().from(apps).where(customApp(id))
  return app ? publicApp(app) : null
}

// Narrowing `scopes` doesn't touch existing installations; they keep what they were granted until re-authorized
export async function updateApp(id: string, patch: Partial<AppInput>) {
  const [app] = await db
    .update(apps)
    .set({ ...patch, ...(patch.scopes && { scopes: normalizeScopes(patch.scopes) }), updatedAt: new Date() })
    .where(customApp(id))
    .returning()
  return app ? publicApp(app) : null
}

// Uninstalls it everywhere: its tokens (and their webhooks) and installations are deleted with it
export async function deleteApp(id: string) {
  const [app] = await db.delete(apps).where(customApp(id)).returning()
  return app ? publicApp(app) : null
}

// The old key stops working right away
export async function rotateKey(id: string) {
  const { privateKey, publicKey } = await generateKeyPair()
  const [app] = await db.update(apps).set({ publicKey, updatedAt: new Date() }).where(customApp(id)).returning()
  return app ? { app: publicApp(app), privateKey } : null
}

// --- OAuth: authorize (consent page) ---

// `scope` as apps send it: comma- or space-separated. Unknown names are an error, not ignored.
export function parseScopes(scope: string): ApiScope[] | null {
  const names = scope.split(/[\s,]+/).filter(Boolean)
  if (!names.every((n): n is ApiScope => (API_SCOPES as readonly string[]).includes(n))) return null
  return normalizeScopes(names as ApiScope[])
}

// write_* covers read_*
const covers = (granted: readonly ApiScope[], scope: ApiScope) =>
  granted.includes(scope) ||
  (scope.startsWith('read_') && granted.includes(scope.replace('read_', 'write_') as ApiScope))

/**
 * Checks an authorize request. invalid_client / invalid_redirect_uri must be shown to the merchant (never
 * redirect to an unverified URL); invalid_scope can be sent back to the verified redirect_uri.
 * Without `scope`, the app gets everything it was registered with.
 */
export async function validateAuthorizeRequest(input: { clientId: string; redirectUri?: string; scope?: string }) {
  const [app] = await db.select().from(apps).where(eq(apps.clientId, input.clientId))
  if (!app) throw new AppError('invalid_client', 'Unknown app (client_id)')
  if (app.delistedAt) throw new AppError('invalid_client', 'This app is no longer available in the App Store')
  // Without redirect_uri: a managed install (the consent screen installs it, nothing is sent to the app)
  if (input.redirectUri !== undefined && !app.redirectUrls.includes(input.redirectUri)) {
    throw new AppError('invalid_redirect_uri', 'redirect_uri is not registered for this app')
  }
  const scopes = input.scope ? parseScopes(input.scope) : app.scopes
  if (!scopes || scopes.length === 0 || !scopes.every((s) => covers(app.scopes, s))) {
    throw new AppError('invalid_scope', `Requested scopes must be among: ${app.scopes.join(', ')}`)
  }
  return { app: publicApp(app), scopes }
}

// The merchant approved: a single-use code the app's backend exchanges within 10 minutes
export async function createAuthorizationCode(input: {
  appId: string
  shopId: string
  userId: string
  scopes: ApiScope[]
  redirectUri: string
}) {
  const code = random(32)
  await db.insert(appAuthorizationCodes).values({
    ...input,
    codeHash: hash(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  // Housekeeping: drop codes that expired over a day ago
  await db.delete(appAuthorizationCodes).where(lt(appAuthorizationCodes.expiresAt, sql`now() - interval '1 day'`))
  return code
}

// --- OAuth: tokens (app backend) ---

/**
 * The app proves who it is with a client assertion signed by its key, addressed to this instance. Throws
 * invalid_client for unknown apps, apps without a key, and assertions that don't check out.
 */
export async function authenticateClient(clientId: string, assertion: string) {
  const [app] = await db.select().from(apps).where(eq(apps.clientId, clientId))
  const valid =
    app?.publicKey &&
    (await verifyClientAssertion(assertion, app.publicKey, { clientId, audience: await instanceUrl() }))
  if (!app || !valid) throw new AppError('invalid_client', 'Invalid client_id or client_assertion')
  return app
}

/**
 * Code → long-lived access token (sk_…), and the installation is created (or updated). Re-authorizing rotates
 * the installation's token in place: the old one stops working, its webhook subscriptions stay.
 */
export async function exchangeCode(input: {
  clientId: string
  clientAssertion: string
  code: string
  redirectUri: string
}) {
  const app = await authenticateClient(input.clientId, input.clientAssertion)
  return db
    .transaction(async (tx) => {
      const [code] = await tx
        .select()
        .from(appAuthorizationCodes)
        .where(and(eq(appAuthorizationCodes.codeHash, hash(input.code)), eq(appAuthorizationCodes.appId, app.id)))
        .for('update')
      if (!code || code.usedAt || code.expiresAt < new Date() || code.redirectUri !== input.redirectUri) {
        throw new AppError(
          'invalid_grant',
          'Authorization code is invalid, expired, already used, or for another redirect_uri',
        )
      }
      await tx.update(appAuthorizationCodes).set({ usedAt: new Date() }).where(eq(appAuthorizationCodes.id, code.id))

      const { token, ...secret } = mintToken()
      const installation = await install(tx, {
        app,
        shopId: code.shopId,
        userId: code.userId,
        scopes: code.scopes,
        secret,
      })
      return { accessToken: token, scopes: code.scopes, shopId: code.shopId, installationId: installation.id, app }
    })
    .then(async ({ app, ...result }) => {
      await reportToMarketplace(app)
      notifyInstalled(app, result.installationId, result.shopId)
      return result
    })
}

// The live installation of an app on a shop, with its (unrevoked) token
async function liveInstallation(appId: string, shopId: string) {
  const [row] = await db
    .select({ installation: appInstallations, token: apiTokens })
    .from(appInstallations)
    .innerJoin(apiTokens, and(eq(apiTokens.id, appInstallations.apiTokenId), isNull(apiTokens.revokedAt)))
    .where(
      and(
        eq(appInstallations.appId, appId),
        eq(appInstallations.shopId, shopId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
  return row ?? null
}

type AccessTokenClaims = {
  iss: string
  sub: string
  client_id: string
  shop_id: string
  scope: string
  iat: number
  exp: number
}

// A 1-hour Admin API token for an installation: a JWT this instance signs, checked on every request against
// the installation (uninstalling revokes it at once)
async function issueAccessToken(app: App, installation: AppInstallation) {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await signJwt(await instanceSigner(), ACCESS_TOKEN_TYP, {
    iss: await instanceUrl(),
    sub: installation.id,
    client_id: app.clientId,
    shop_id: installation.shopId,
    scope: installation.scopes.join(','),
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_S,
  } satisfies AccessTokenClaims)
  return {
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_S,
    scopes: installation.scopes,
    shopId: installation.shopId,
    installationId: installation.id,
  }
}

/** Session token (from the embedded admin page) → access token for its installation */
export async function exchangeSessionToken(input: { clientId: string; clientAssertion: string; subjectToken: string }) {
  const app = await authenticateClient(input.clientId, input.clientAssertion)
  const claims = await verifyJwt<SessionTokenClaims>(input.subjectToken, SESSION_TOKEN_TYP, (header) =>
    ownKey(header.kid),
  )
  if (!claims || claims.aud !== app.clientId) throw new AppError('invalid_grant', 'Invalid or expired session token')
  const live = await liveInstallation(app.id, claims.shop_id)
  if (!live || live.installation.id !== claims.sid) throw new AppError('invalid_grant', 'App is not installed')
  return issueAccessToken(app, live.installation)
}

/** Background work: an access token for the app's live installation on `shopId` */
export async function clientCredentials(input: { clientId: string; clientAssertion: string; shopId: string }) {
  const app = await authenticateClient(input.clientId, input.clientAssertion)
  const live = await liveInstallation(app.id, input.shopId)
  if (!live) throw new AppError('invalid_grant', 'App is not installed on this shop')
  return issueAccessToken(app, live.installation)
}

/** Bearer access token (JWT) → the installation's API token and shop. Null if invalid, expired or uninstalled. */
export async function resolveAccessToken(
  token: string,
): Promise<{ token: ApiToken; shop: typeof shops.$inferSelect } | null> {
  if (decodeJwt(token)?.header.typ !== ACCESS_TOKEN_TYP) return null
  const claims = await verifyJwt<AccessTokenClaims>(token, ACCESS_TOKEN_TYP, (header) => ownKey(header.kid))
  if (!claims) return null
  const [row] = await db
    .select({ token: apiTokens, shop: shops })
    .from(appInstallations)
    .innerJoin(apiTokens, and(eq(apiTokens.id, appInstallations.apiTokenId), isNull(apiTokens.revokedAt)))
    .innerJoin(shops, eq(shops.id, appInstallations.shopId))
    .where(
      and(
        eq(appInstallations.id, claims.sub),
        eq(appInstallations.shopId, claims.shop_id),
        isNull(appInstallations.uninstalledAt),
      ),
    )
  if (!row) return null
  touchToken(row.token.id)
  return row
}

/**
 * Managed install: the merchant approved in the admin. Creates (or updates) the installation; the app gets
 * tokens with the token exchange / client credentials grants, so no token leaves this function.
 */
export async function installManaged(input: { appId: string; shopId: string; userId: string; scopes: ApiScope[] }) {
  const { installation, app } = await db.transaction(async (tx) => {
    const [app] = await tx.select().from(apps).where(eq(apps.id, input.appId))
    if (!app) throw new AppError('APP_NOT_FOUND', 'App not found')
    const { token: _, ...secret } = mintToken()
    const installation = await install(tx, {
      app,
      shopId: input.shopId,
      userId: input.userId,
      scopes: input.scopes,
      secret,
    })
    return { installation, app }
  })
  await reportToMarketplace(app)
  notifyInstalled(app, installation.id, installation.shopId)
  return installation
}

/**
 * A marketplace app asks the marketplace "is this install real?" before it trusts an instance, and the marketplace
 * only knows what we report. So report first, then let the app (and the merchant, who is sent into it next) in:
 * after the install commits and before the app is notified. Never throws and gives up after 5s (a failed report
 * heals on the next sync, and the app checks again when it is opened). Other apps are not the marketplace's business.
 */
async function reportToMarketplace(app: Pick<App, 'source'>) {
  if (app.source === 'marketplace') await reportInstallationsSoon()
}

/**
 * Tells the app it was installed (see @shopnex/marketplace-sdk/lifecycle), so it can set the shop up before
 * anyone opens it. Called after the install commits, never awaited: best effort, an app that misses it sets up
 * when it's first opened.
 */
function notifyInstalled(app: App, installationId: string, shopId: string) {
  void (async () => {
    const id = randomUUID()
    const payload: AppInstalledRequest = {
      kind: 'installed',
      id,
      instance: await instanceUrl(),
      shopId,
      installationId,
    }
    const body = JSON.stringify(payload)
    const res = await fetch(serverUrl(app.appUrl.replace(/\/$/, '')) + APP_INSTALLED_PATH, {
      method: 'POST',
      headers: await signLifecycleRequest(await instanceSigner(), id, body),
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    // 404: an app that doesn't listen for it
    if (!res.ok && res.status !== 404) throw new Error(`${res.status} ${res.statusText}`)
  })().catch((error) => log.error({ err: error, clientId: app.clientId }, 'app.installed delivery failed'))
}

async function install(
  tx: Conn,
  input: {
    app: App
    shopId: string
    userId: string | null
    scopes: ApiScope[]
    secret: { tokenHash: string; tokenPrefix: string }
  },
) {
  const [existing] = await tx
    .select({ installation: appInstallations, token: apiTokens })
    .from(appInstallations)
    .leftJoin(apiTokens, and(eq(apiTokens.id, appInstallations.apiTokenId), isNull(apiTokens.revokedAt)))
    .where(and(eq(appInstallations.appId, input.app.id), eq(appInstallations.shopId, input.shopId)))
    .for('update', { of: appInstallations })

  // Already installed: new secret and scopes on the same token row
  if (existing?.token && !existing.installation.uninstalledAt) {
    await tx
      .update(apiTokens)
      .set({ ...input.secret, scopes: input.scopes, name: input.app.name })
      .where(eq(apiTokens.id, existing.token.id))
    const [installation] = await tx
      .update(appInstallations)
      .set({ scopes: input.scopes })
      .where(eq(appInstallations.id, existing.installation.id))
      .returning()
    return installation!
  }

  const [token] = await tx
    .insert(apiTokens)
    .values({
      shopId: input.shopId,
      appId: input.app.id,
      name: input.app.name,
      scopes: input.scopes,
      createdById: input.userId,
      ...input.secret,
    })
    .returning({ id: apiTokens.id })
  const values = {
    apiTokenId: token!.id,
    scopes: input.scopes,
    installedById: input.userId,
    installedAt: new Date(),
    uninstalledAt: null,
  }
  const [installation] = existing
    ? await tx.update(appInstallations).set(values).where(eq(appInstallations.id, existing.installation.id)).returning()
    : await tx
        .insert(appInstallations)
        .values({ ...values, appId: input.app.id, shopId: input.shopId })
        .returning()
  return installation!
}

// --- Catalog (every app a shop can install, whatever its source) ---

/**
 * One list for everything installable from Admin → Apps: apps that ship with this install (BUNDLED_APPS),
 * marketplace apps synced to this instance, and custom apps a super admin registered. `installed` is per shop.
 */
export async function listCatalog(shopId: string) {
  const rows = await db
    .select({ app: apps, installationId: appInstallations.id })
    .from(apps)
    .leftJoin(
      appInstallations,
      and(
        eq(appInstallations.appId, apps.id),
        eq(appInstallations.shopId, shopId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
    .where(isNull(apps.delistedAt))
    .orderBy(asc(apps.name))
  return rows.map((r) => ({
    ...publicApp(r.app),
    origin: r.app.source,
    installationId: r.installationId,
    installed: r.installationId !== null,
  }))
}

// --- installations (shop owners/admins) ---

const installedApps = (shopId: string) =>
  db
    .select({
      installation: appInstallations,
      app: apps,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(appInstallations)
    .innerJoin(apps, eq(apps.id, appInstallations.appId))
    .leftJoin(apiTokens, eq(apiTokens.id, appInstallations.apiTokenId))
    .where(and(eq(appInstallations.shopId, shopId), isNull(appInstallations.uninstalledAt)))

export async function listInstallations(shopId: string) {
  const rows = (await installedApps(shopId).orderBy(desc(appInstallations.installedAt))).filter(
    ({ app }) => !isBundledAppUnavailable(app),
  )
  return rows.map(({ installation, app, lastUsedAt }) => ({
    ...installation,
    app: publicApp(app),
    lastUsedAt,
  }))
}

// The shop's live installation of an app (consent page: "already installed")
export async function getInstallation(shopId: string, appId: string) {
  const [row] = await db
    .select()
    .from(appInstallations)
    .where(
      and(
        eq(appInstallations.shopId, shopId),
        eq(appInstallations.appId, appId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
  return row ?? null
}

// Revokes the token (and its webhooks); the row stays so reinstalling is recognised. Null if not installed.
export async function uninstall(shopId: string, installationId: string) {
  return db.transaction(async (tx) => {
    const [installation] = await tx
      .select()
      .from(appInstallations)
      .where(
        and(
          eq(appInstallations.shopId, shopId),
          eq(appInstallations.id, installationId),
          isNull(appInstallations.uninstalledAt),
        ),
      )
      .for('update')
    if (!installation) return null
    if (installation.apiTokenId) await revokeTokenById(shopId, installation.apiTokenId, tx)
    // What other modules keep for the app goes with it: a payments app's method leaves checkout (orders keep their gateway
    // snapshot), an AI app's capabilities stop being offered (its generations stay in the shop's history), a carrier app's service
    // leaves checkout
    await appUninstalled.run(tx, { shopId, appId: installation.appId })
    // …and its scripts leave the online store
    await tx
      .delete(appStorefrontScripts)
      .where(and(eq(appStorefrontScripts.shopId, shopId), eq(appStorefrontScripts.appId, installation.appId)))
    const [updated] = await tx
      .update(appInstallations)
      .set({ uninstalledAt: new Date(), apiTokenId: null })
      .where(eq(appInstallations.id, installationId))
      .returning()
    return updated!
  })
}

// --- storefront scripts ---

/** An app may add at most this many scripts to a shop's online store */
export const MAX_STOREFRONT_SCRIPTS = 5

/**
 * The scripts this app adds to the shop's online store: replaces its whole set. Each address must be on the app's
 * own origin (its registered app URL), so an app can't make ShopNex load someone else's script, and marketplace
 * apps are refused until their listings are reviewed (a script runs on every page of the store, with the
 * shopper's session). An empty list removes them all. Returns the set as saved.
 */
export async function configureStorefrontScripts(shopId: string, appId: string, scripts: string[], conn: Conn) {
  const [app] = await conn.select().from(apps).where(eq(apps.id, appId))
  if (!app) throw new AppError('APP_NOT_FOUND', 'App not found')
  if (app.source === 'marketplace') {
    throw new AppError('SCRIPTS_NOT_ALLOWED', 'Marketplace apps can not add scripts to the online store yet')
  }
  const appOrigin = publicOrigin(app.appUrl)
  const wanted = [...new Set(scripts)]
  if (wanted.length > MAX_STOREFRONT_SCRIPTS) {
    throw new AppError('SCRIPT_URL_INVALID', `At most ${MAX_STOREFRONT_SCRIPTS} scripts`)
  }
  for (const src of wanted) {
    if (!appOrigin || publicOrigin(src) !== appOrigin) {
      throw new AppError('SCRIPT_URL_INVALID', `A script must be on the app's own origin (${appOrigin ?? app.appUrl})`)
    }
  }
  await conn.transaction(async (tx) => {
    const mine = and(eq(appStorefrontScripts.shopId, shopId), eq(appStorefrontScripts.appId, appId))
    const have = await tx.select({ src: appStorefrontScripts.src }).from(appStorefrontScripts).where(mine)
    for (const { src } of have) {
      if (!wanted.includes(src))
        await tx.delete(appStorefrontScripts).where(and(mine, eq(appStorefrontScripts.src, src)))
    }
    const kept = new Set(have.map((h) => h.src))
    const added = wanted.filter((src) => !kept.has(src))
    if (added.length) await tx.insert(appStorefrontScripts).values(added.map((src) => ({ shopId, appId, src })))
  })
  return wanted
}

/** What the online store loads on every page: the scripts of apps that are installed in this shop now */
export async function storefrontScripts(shopId: string, conn: Conn) {
  const rows = await conn
    .select({ src: appStorefrontScripts.src })
    .from(appStorefrontScripts)
    .innerJoin(apps, eq(apps.id, appStorefrontScripts.appId))
    .innerJoin(
      appInstallations,
      and(
        eq(appInstallations.appId, appStorefrontScripts.appId),
        eq(appInstallations.shopId, appStorefrontScripts.shopId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
    .where(and(eq(appStorefrontScripts.shopId, shopId), isNull(apps.delistedAt), sql`${apps.source} <> 'marketplace'`))
    .orderBy(asc(appStorefrontScripts.createdAt), asc(appStorefrontScripts.src))
  return [...new Set(rows.map((r) => r.src))]
}

// --- embedded apps ---

// A live installation of this shop, with its app (embedded app page)
export async function getInstallationWithApp(shopId: string, installationId: string) {
  const [row] = await db
    .select({ installation: appInstallations, app: apps })
    .from(appInstallations)
    .innerJoin(apps, eq(apps.id, appInstallations.appId))
    .where(
      and(
        eq(appInstallations.shopId, shopId),
        eq(appInstallations.id, installationId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
  if (!row) return null
  return { ...row.installation, app: publicApp(row.app) }
}

/**
 * A 60-second token telling the embedded app which staff member of which shop is using it (see
 * @shopnex/app-bridge), signed with this instance's key.
 */
export async function createSessionToken(input: { shopId: string; installationId: string; userId: string }) {
  const [row] = await db
    .select({ installation: appInstallations, clientId: apps.clientId })
    .from(appInstallations)
    .innerJoin(apps, eq(apps.id, appInstallations.appId))
    .where(
      and(
        eq(appInstallations.shopId, input.shopId),
        eq(appInstallations.id, input.installationId),
        isNull(appInstallations.uninstalledAt),
      ),
    )
  if (!row) throw new AppError('INSTALLATION_NOT_FOUND', 'App is not installed')
  return signSessionToken(await instanceSigner(), {
    iss: await instanceUrl(),
    aud: row.clientId,
    sub: input.userId,
    shop_id: input.shopId,
    sid: row.installation.id,
  })
}

// --- app data (an app's own per-shop storage) ---

const APP_DATA_MAX_BYTES = 64 * 1024
const APP_DATA_MAX_KEYS = 100

// The installation an API token belongs to: only an app's own token reaches its data
async function tokenInstallation(token: ApiToken) {
  if (!token.appId) throw new AppError('APP_NOT_FOUND', "Only an app's own token can use app data")
  const [row] = await db
    .select({ id: appInstallations.id })
    .from(appInstallations)
    .where(and(eq(appInstallations.apiTokenId, token.id), isNull(appInstallations.uninstalledAt)))
  if (!row) throw new AppError('INSTALLATION_NOT_FOUND', 'App is not installed')
  return row.id
}

export async function listAppData(token: ApiToken) {
  const installationId = await tokenInstallation(token)
  const rows = await db
    .select({ key: appData.key, value: appData.value, updatedAt: appData.updatedAt })
    .from(appData)
    .where(eq(appData.installationId, installationId))
    .orderBy(asc(appData.key))
  return rows
}

export async function getAppData(token: ApiToken, key: string) {
  const installationId = await tokenInstallation(token)
  const [row] = await db
    .select({ key: appData.key, value: appData.value, updatedAt: appData.updatedAt })
    .from(appData)
    .where(and(eq(appData.installationId, installationId), eq(appData.key, key)))
  return row ?? null
}

export async function setAppData(token: ApiToken, key: string, value: unknown) {
  const installationId = await tokenInstallation(token)
  if (JSON.stringify(value).length > APP_DATA_MAX_BYTES) {
    throw new AppError('APP_DATA_TOO_LARGE', `A value can be at most ${APP_DATA_MAX_BYTES / 1024} KB`)
  }
  return db.transaction(async (tx) => {
    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(appData)
      .where(and(eq(appData.installationId, installationId), sql`${appData.key} <> ${key}`))) as [{ count: number }]
    if (count >= APP_DATA_MAX_KEYS) {
      throw new AppError('APP_DATA_TOO_LARGE', `An app can keep at most ${APP_DATA_MAX_KEYS} keys per shop`)
    }
    const [row] = await tx
      .insert(appData)
      .values({ installationId, key, value })
      .onConflictDoUpdate({
        target: [appData.installationId, appData.key],
        set: { value, updatedAt: new Date() },
      })
      .returning({ key: appData.key, value: appData.value, updatedAt: appData.updatedAt })
    return row!
  })
}

export async function deleteAppData(token: ApiToken, key: string) {
  const installationId = await tokenInstallation(token)
  const [row] = await db
    .delete(appData)
    .where(and(eq(appData.installationId, installationId), eq(appData.key, key)))
    .returning({ key: appData.key })
  return row ?? null
}

// --- bundled apps ---

/**
 * First-party apps that ship with ShopNex and run next to it (e.g. apps/stripe). Each is registered as a
 * custom, managed app with a fixed client id, so staff only click Install. ShopNex learns its public key from
 * the app itself (GET {url}/.well-known/shopnex-app.json). The address is operator config, which is why the key is
 * trusted: either <NAME>_APP_URL, or, with SHOPNEX_BUNDLED_APPS=docker (the Compose files), the app's default
 * internal address on the Compose network, where the app announces its own public URL. Otherwise it is left alone.
 */
const BUNDLED_APPS = [
  {
    clientId: 'app_stripe',
    urlEnv: 'STRIPE_APP_URL',
    internalUrl: 'http://stripe:4600',
    name: 'Stripe',
    description: 'Accept card payments, Apple Pay and Google Pay with Stripe Checkout.',
    scopes: ['read_orders', 'write_payment_sessions'] as ApiScope[],
  },
  {
    clientId: 'app_cj_dropshipping',
    urlEnv: 'CJ_DROPSHIPPING_APP_URL',
    internalUrl: 'http://cj-dropshipping:4700',
    name: 'CJ Dropshipping',
    description: 'Import CJ Dropshipping products and send paid orders to CJ.',
    // write_shipping: quote CJ's shipping prices at checkout (a carrier service)
    scopes: ['write_products', 'write_orders', 'write_shipping'] as ApiScope[],
  },
  {
    clientId: 'app_shippo',
    urlEnv: 'SHIPPO_APP_URL',
    internalUrl: 'http://shippo:4900',
    name: 'Shippo',
    description: 'Live shipping rates at checkout from the carriers on your Shippo account (USPS, UPS, FedEx, DHL…).',
    scopes: ['write_shipping'] as ApiScope[],
  },
]

type BundledApp = (typeof BUNDLED_APPS)[number]

// Bundled apps whose last check failed (cleared when one succeeds). An app not checked yet isn't in here, so
// a restart doesn't hide every installed app until the first check is done.
const failingBundled = new Set<string>()

/**
 * A bundled app that can't be used on this install: it isn't part of this build (a database from another
 * version or branch), it isn't configured, or it isn't answering. Such an app is left out of the installed list
 * rather than shown as something to open; the installation itself is kept and returns with the app.
 */
function isBundledAppUnavailable(app: { source: string; clientId: string }) {
  if (app.source !== 'bundled') return false
  const bundled = BUNDLED_APPS.find((b) => b.clientId === app.clientId)
  if (!bundled) return true
  const configured = !!process.env[bundled.urlEnv]?.trim() || process.env.SHOPNEX_BUNDLED_APPS === 'docker'
  return !configured || failingBundled.has(bundled.clientId)
}

// An announced public URL is shown to staff and opened in their browser: https, or plain http on this machine only
function publicOrigin(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.origin : null
  } catch {
    return null
  }
}

/** `url` is the operator's <NAME>_APP_URL; without it the app is at its internal address and announces its own */
async function syncBundledApp(bundled: BundledApp, url: string | undefined) {
  const reach = url ?? bundled.internalUrl
  const res = await fetch(`${serverUrl(reach)}/.well-known/shopnex-app.json`, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`${reach} answered ${res.status}`)
  const identity = (await res.json()) as { clientId?: string; publicKey?: string; appUrl?: string }
  if (identity.clientId !== bundled.clientId || typeof identity.publicKey !== 'string') {
    throw new Error(`${reach} is not the ${bundled.name} app`)
  }
  await importPublicKey(identity.publicKey) // throws unless it's an Ed25519 key
  const appUrl = url ?? publicOrigin(identity.appUrl)
  if (!appUrl) throw new Error(`${reach} announced no usable public URL (https, or http on localhost)`)
  if (!url) rememberInternalUrl(appUrl, bundled.internalUrl)
  const values = {
    source: 'bundled' as const,
    name: bundled.name,
    description: bundled.description,
    iconUrl: `${appUrl}/icon.svg`,
    appUrl,
    redirectUrls: [],
    scopes: normalizeScopes(bundled.scopes),
    publicKey: identity.publicKey,
    updatedAt: new Date(),
  }
  await db
    .insert(apps)
    .values({ ...values, clientId: bundled.clientId })
    .onConflictDoUpdate({ target: apps.clientId, set: values })
}

/**
 * Registers the bundled apps that are configured or, under Docker, found. The app may start after ShopNex (or not
 * at all: an optional app), so a failure is retried with a growing delay; once registered it is checked again now
 * and then, which picks up a replaced key (the app's data folder was recreated: it is a new app and merchants
 * reconnect). An app that is not configured and not answering is not an error, so it is retried quietly.
 */
export function registerBundledApps() {
  const docker = process.env.SHOPNEX_BUNDLED_APPS === 'docker'
  for (const bundled of BUNDLED_APPS) {
    const url = process.env[bundled.urlEnv]?.trim().replace(/\/$/, '') || undefined
    if (!url && !docker) continue
    const attempt = async (failures: number) => {
      let next = 10 * 60_000
      try {
        await syncBundledApp(bundled, url)
        failingBundled.delete(bundled.clientId)
        failures = 0
      } catch (error) {
        if (failures === 0 && url)
          log.warn('%s not registered yet, retrying: %s', bundled.name, (error as Error).message)
        failingBundled.add(bundled.clientId)
        next = Math.min(5000 * 2 ** failures, 60_000)
        failures++
      }
      setTimeout(() => void attempt(failures), next).unref()
    }
    void attempt(0)
  }
}
