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
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { API_SCOPES, type ApiScope, type App, type AppInstallation } from '@shopnex/db/schema'
import {
  decodeJwt,
  generateKeyPair,
  importPublicKey,
  signJwt,
  verifyClientAssertion,
  verifyJwt,
} from '@shopnex/marketplace-sdk/keys'
import {
  APP_INSTALLED_PATH,
  signLifecycleRequest,
  type AppInstalledRequest,
} from '@shopnex/marketplace-sdk/lifecycle'
import { SESSION_TOKEN_TYP, signSessionToken, type SessionTokenClaims } from '@shopnex/marketplace-sdk/session-token'
import { mintToken, normalizeScopes, revokeTokenById, touchToken, type ApiToken } from '@shopnex/tenancy'
import { AppError } from './errors'
import { instanceSigner, ownKey } from './keys'
import { rememberInternalUrl, serverUrl } from './internal-url'
import { instanceUrl } from './marketplace'

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')
const random = (bytes: number) => randomBytes(bytes).toString('base64url')

const CODE_TTL_MS = 10 * 60_000
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
    .insert(schema.apps)
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
const customApp = (id: string) => and(eq(schema.apps.id, id), eq(schema.apps.source, 'custom'))

export async function listApps() {
  const rows = await db
    .select()
    .from(schema.apps)
    .where(eq(schema.apps.source, 'custom'))
    .orderBy(asc(schema.apps.name))
  return rows.map(publicApp)
}

export async function getApp(id: string) {
  const [app] = await db.select().from(schema.apps).where(customApp(id))
  return app ? publicApp(app) : null
}

// Narrowing `scopes` doesn't touch existing installations; they keep what they were granted until re-authorized
export async function updateApp(id: string, patch: Partial<AppInput>) {
  const [app] = await db
    .update(schema.apps)
    .set({ ...patch, ...(patch.scopes && { scopes: normalizeScopes(patch.scopes) }), updatedAt: new Date() })
    .where(customApp(id))
    .returning()
  return app ? publicApp(app) : null
}

// Uninstalls it everywhere: its tokens (and their webhooks) and installations are deleted with it
export async function deleteApp(id: string) {
  const [app] = await db.delete(schema.apps).where(customApp(id)).returning()
  return app ? publicApp(app) : null
}

// The old key stops working right away
export async function rotateKey(id: string) {
  const { privateKey, publicKey } = await generateKeyPair()
  const [app] = await db.update(schema.apps).set({ publicKey, updatedAt: new Date() }).where(customApp(id)).returning()
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
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.clientId, input.clientId))
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
  await db.insert(schema.appAuthorizationCodes).values({
    ...input,
    codeHash: hash(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  // Housekeeping: drop codes that expired over a day ago
  await db
    .delete(schema.appAuthorizationCodes)
    .where(lt(schema.appAuthorizationCodes.expiresAt, sql`now() - interval '1 day'`))
  return code
}

// --- OAuth: tokens (app backend) ---

/**
 * The app proves who it is with a client assertion signed by its key, addressed to this instance. Throws
 * invalid_client for unknown apps, apps without a key, and assertions that don't check out.
 */
export async function authenticateClient(clientId: string, assertion: string) {
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.clientId, clientId))
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
  return db.transaction(async (tx) => {
    const [code] = await tx
      .select()
      .from(schema.appAuthorizationCodes)
      .where(
        and(
          eq(schema.appAuthorizationCodes.codeHash, hash(input.code)),
          eq(schema.appAuthorizationCodes.appId, app.id),
        ),
      )
      .for('update')
    if (!code || code.usedAt || code.expiresAt < new Date() || code.redirectUri !== input.redirectUri) {
      throw new AppError(
        'invalid_grant',
        'Authorization code is invalid, expired, already used, or for another redirect_uri',
      )
    }
    await tx
      .update(schema.appAuthorizationCodes)
      .set({ usedAt: new Date() })
      .where(eq(schema.appAuthorizationCodes.id, code.id))

    const { token, ...secret } = mintToken()
    const installation = await install(tx, {
      app,
      shopId: code.shopId,
      userId: code.userId,
      scopes: code.scopes,
      secret,
    })
    return { accessToken: token, scopes: code.scopes, shopId: code.shopId, installationId: installation.id, app }
  }).then(({ app, ...result }) => {
    notifyInstalled(app, result.installationId, result.shopId)
    return result
  })
}

// The live installation of an app on a shop, with its (unrevoked) token
async function liveInstallation(appId: string, shopId: string) {
  const [row] = await db
    .select({ installation: schema.appInstallations, token: schema.apiTokens })
    .from(schema.appInstallations)
    .innerJoin(
      schema.apiTokens,
      and(eq(schema.apiTokens.id, schema.appInstallations.apiTokenId), isNull(schema.apiTokens.revokedAt)),
    )
    .where(
      and(
        eq(schema.appInstallations.appId, appId),
        eq(schema.appInstallations.shopId, shopId),
        isNull(schema.appInstallations.uninstalledAt),
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
): Promise<{ token: ApiToken; shop: typeof schema.shops.$inferSelect } | null> {
  if (decodeJwt(token)?.header.typ !== ACCESS_TOKEN_TYP) return null
  const claims = await verifyJwt<AccessTokenClaims>(token, ACCESS_TOKEN_TYP, (header) => ownKey(header.kid))
  if (!claims) return null
  const [row] = await db
    .select({ token: schema.apiTokens, shop: schema.shops })
    .from(schema.appInstallations)
    .innerJoin(
      schema.apiTokens,
      and(eq(schema.apiTokens.id, schema.appInstallations.apiTokenId), isNull(schema.apiTokens.revokedAt)),
    )
    .innerJoin(schema.shops, eq(schema.shops.id, schema.appInstallations.shopId))
    .where(
      and(
        eq(schema.appInstallations.id, claims.sub),
        eq(schema.appInstallations.shopId, claims.shop_id),
        isNull(schema.appInstallations.uninstalledAt),
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
    const [app] = await tx.select().from(schema.apps).where(eq(schema.apps.id, input.appId))
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
  notifyInstalled(app, installation.id, installation.shopId)
  return installation
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
  })().catch((error) => console.error(`[apps] app.installed for ${app.clientId}:`, error))
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
    .select({ installation: schema.appInstallations, token: schema.apiTokens })
    .from(schema.appInstallations)
    .leftJoin(
      schema.apiTokens,
      and(eq(schema.apiTokens.id, schema.appInstallations.apiTokenId), isNull(schema.apiTokens.revokedAt)),
    )
    .where(and(eq(schema.appInstallations.appId, input.app.id), eq(schema.appInstallations.shopId, input.shopId)))
    .for('update', { of: schema.appInstallations })

  // Already installed: new secret and scopes on the same token row
  if (existing?.token && !existing.installation.uninstalledAt) {
    await tx
      .update(schema.apiTokens)
      .set({ ...input.secret, scopes: input.scopes, name: input.app.name })
      .where(eq(schema.apiTokens.id, existing.token.id))
    const [installation] = await tx
      .update(schema.appInstallations)
      .set({ scopes: input.scopes })
      .where(eq(schema.appInstallations.id, existing.installation.id))
      .returning()
    return installation!
  }

  const [token] = await tx
    .insert(schema.apiTokens)
    .values({
      shopId: input.shopId,
      appId: input.app.id,
      name: input.app.name,
      scopes: input.scopes,
      createdById: input.userId,
      ...input.secret,
    })
    .returning({ id: schema.apiTokens.id })
  const values = {
    apiTokenId: token!.id,
    scopes: input.scopes,
    installedById: input.userId,
    installedAt: new Date(),
    uninstalledAt: null,
  }
  const [installation] = existing
    ? await tx
        .update(schema.appInstallations)
        .set(values)
        .where(eq(schema.appInstallations.id, existing.installation.id))
        .returning()
    : await tx
        .insert(schema.appInstallations)
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
    .where(isNull(schema.apps.delistedAt))
    .orderBy(asc(schema.apps.name))
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
      installation: schema.appInstallations,
      app: schema.apps,
      lastUsedAt: schema.apiTokens.lastUsedAt,
    })
    .from(schema.appInstallations)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.appInstallations.appId))
    .leftJoin(schema.apiTokens, eq(schema.apiTokens.id, schema.appInstallations.apiTokenId))
    .where(and(eq(schema.appInstallations.shopId, shopId), isNull(schema.appInstallations.uninstalledAt)))

export async function listInstallations(shopId: string) {
  const rows = await installedApps(shopId).orderBy(desc(schema.appInstallations.installedAt))
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
    .from(schema.appInstallations)
    .where(
      and(
        eq(schema.appInstallations.shopId, shopId),
        eq(schema.appInstallations.appId, appId),
        isNull(schema.appInstallations.uninstalledAt),
      ),
    )
  return row ?? null
}

// Revokes the token (and its webhooks); the row stays so reinstalling is recognised. Null if not installed.
export async function uninstall(shopId: string, installationId: string) {
  return db.transaction(async (tx) => {
    const [installation] = await tx
      .select()
      .from(schema.appInstallations)
      .where(
        and(
          eq(schema.appInstallations.shopId, shopId),
          eq(schema.appInstallations.id, installationId),
          isNull(schema.appInstallations.uninstalledAt),
        ),
      )
      .for('update')
    if (!installation) return null
    if (installation.apiTokenId) await revokeTokenById(shopId, installation.apiTokenId, tx)
    // A payments app's method leaves checkout with it (orders keep their gateway snapshot)
    await tx
      .delete(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.shopId, shopId), eq(schema.paymentMethods.appId, installation.appId)))
    // So does a carrier app's service: its rates stop being offered at checkout
    await tx
      .delete(schema.carrierServices)
      .where(and(eq(schema.carrierServices.shopId, shopId), eq(schema.carrierServices.appId, installation.appId)))
    const [updated] = await tx
      .update(schema.appInstallations)
      .set({ uninstalledAt: new Date(), apiTokenId: null })
      .where(eq(schema.appInstallations.id, installationId))
      .returning()
    return updated!
  })
}

// --- embedded apps ---

// A live installation of this shop, with its app (embedded app page)
export async function getInstallationWithApp(shopId: string, installationId: string) {
  const [row] = await db
    .select({ installation: schema.appInstallations, app: schema.apps })
    .from(schema.appInstallations)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.appInstallations.appId))
    .where(
      and(
        eq(schema.appInstallations.shopId, shopId),
        eq(schema.appInstallations.id, installationId),
        isNull(schema.appInstallations.uninstalledAt),
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
    .select({ installation: schema.appInstallations, clientId: schema.apps.clientId })
    .from(schema.appInstallations)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.appInstallations.appId))
    .where(
      and(
        eq(schema.appInstallations.shopId, input.shopId),
        eq(schema.appInstallations.id, input.installationId),
        isNull(schema.appInstallations.uninstalledAt),
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
    .select({ id: schema.appInstallations.id })
    .from(schema.appInstallations)
    .where(and(eq(schema.appInstallations.apiTokenId, token.id), isNull(schema.appInstallations.uninstalledAt)))
  if (!row) throw new AppError('INSTALLATION_NOT_FOUND', 'App is not installed')
  return row.id
}

export async function listAppData(token: ApiToken) {
  const installationId = await tokenInstallation(token)
  const rows = await db
    .select({ key: schema.appData.key, value: schema.appData.value, updatedAt: schema.appData.updatedAt })
    .from(schema.appData)
    .where(eq(schema.appData.installationId, installationId))
    .orderBy(asc(schema.appData.key))
  return rows
}

export async function getAppData(token: ApiToken, key: string) {
  const installationId = await tokenInstallation(token)
  const [row] = await db
    .select({ key: schema.appData.key, value: schema.appData.value, updatedAt: schema.appData.updatedAt })
    .from(schema.appData)
    .where(and(eq(schema.appData.installationId, installationId), eq(schema.appData.key, key)))
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
      .from(schema.appData)
      .where(and(eq(schema.appData.installationId, installationId), sql`${schema.appData.key} <> ${key}`))) as [
      { count: number },
    ]
    if (count >= APP_DATA_MAX_KEYS) {
      throw new AppError('APP_DATA_TOO_LARGE', `An app can keep at most ${APP_DATA_MAX_KEYS} keys per shop`)
    }
    const [row] = await tx
      .insert(schema.appData)
      .values({ installationId, key, value })
      .onConflictDoUpdate({
        target: [schema.appData.installationId, schema.appData.key],
        set: { value, updatedAt: new Date() },
      })
      .returning({ key: schema.appData.key, value: schema.appData.value, updatedAt: schema.appData.updatedAt })
    return row!
  })
}

export async function deleteAppData(token: ApiToken, key: string) {
  const installationId = await tokenInstallation(token)
  const [row] = await db
    .delete(schema.appData)
    .where(and(eq(schema.appData.installationId, installationId), eq(schema.appData.key, key)))
    .returning({ key: schema.appData.key })
  return row ?? null
}

// --- bundled apps ---

/**
 * First-party apps that ship with Shopnex and run next to it (e.g. apps/stripe). Each is registered as a
 * custom, managed app with a fixed client id, so staff only click Install. Shopnex learns its public key from
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
]

type BundledApp = (typeof BUNDLED_APPS)[number]

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
    .insert(schema.apps)
    .values({ ...values, clientId: bundled.clientId })
    .onConflictDoUpdate({ target: schema.apps.clientId, set: values })
}

/**
 * Registers the bundled apps that are configured or, under Docker, found. The app may start after Shopnex (or not
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
        failures = 0
      } catch (error) {
        if (failures === 0 && url)
          console.warn(`[apps] ${bundled.name} not registered yet, retrying:`, (error as Error).message)
        next = Math.min(5000 * 2 ** failures, 60_000)
        failures++
      }
      setTimeout(() => void attempt(failures), next).unref()
    }
    void attempt(0)
  }
}
