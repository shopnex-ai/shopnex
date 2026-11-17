import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { CLIENT_ASSERTION_TYPE } from '@shopnex/marketplace-sdk/keys'
import { createProcedures } from '@shopnex/rpc'
import * as appService from './apps'
import {
  appCatalogOutput,
  appDataItemOutput,
  appDataKeyOutput,
  appDataValueOutput,
  appInput,
  appInstallationOutput,
  appInstalledOutput,
  appOutput,
  appRegisteredOutput,
  marketplaceConnectedOutput,
  marketplaceConnectInput,
  marketplaceConnectionOutput,
  okOutput,
  sessionTokenOutput,
} from './apps.contract'
import { jwks } from './keys'
import * as marketplaceService from './marketplace'

const { adminOrToken, pub, shopManager, superAdminOnly } = createProcedures()

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Admin → Apps: what this shop has installed (owners/admins). Installing happens through OAuth (/admin/oauth/authorize).
export const apps = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/apps' })
    .output(z.array(appInstalledOutput))
    .handler(({ context }) => appService.listInstallations(context.shop.id)),

  // Revokes the app's token and deletes its webhooks
  uninstall: shopManager
    .route({ method: 'POST', path: '/admin/apps/{id}/uninstall' })
    .output(appInstallationOutput)
    .input(id)
    .handler(async ({ input, context }) => {
      const installation = found(await appService.uninstall(context.shop.id, input.id))
      void marketplaceService.reportInstallationsSoon()
      return installation
    }),

  // Embedded app page: the app's frontend asks for one through @shopnex/app-bridge (valid 60s)
  sessionToken: shopManager
    .route({ method: 'POST', path: '/admin/apps/{id}/session-token' })
    .output(sessionTokenOutput)
    .input(id)
    .handler(async ({ input, context }) => ({
      token: await appService.createSessionToken({
        shopId: context.shop.id,
        installationId: input.id,
        userId: context.user.id,
      }),
    })),

  // Everything this shop can install (bundled, marketplace, custom), each marked installed or not. Install goes to
  // the consent screen, or opens the app's URL (?shop_id=…&instance=…) where it starts OAuth.
  catalog: shopManager
    .route({ method: 'GET', path: '/admin/apps/catalog' })
    .output(appCatalogOutput)
    .handler(async ({ context }) => {
      const [connection, instanceUrl, apps] = await Promise.all([
        marketplaceService.getConnection(),
        marketplaceService.instanceUrl(),
        appService.listCatalog(context.shop.id),
      ])
      return { marketplaceConnected: Boolean(connection?.instanceKey), instanceUrl, apps }
    }),
}

// Admin → Apps → Marketplace (super admins): this instance's link to the app marketplace
export const marketplaceConnection = {
  get: superAdminOnly
    .route({ method: 'GET', path: '/admin/marketplace' })
    .output(marketplaceConnectionOutput)
    .handler(async () => {
      const connection = await marketplaceService.getConnection()
      if (!connection?.instanceKey) return null
      const { instanceKey: _, pendingChallenge: __, ...visible } = connection
      return visible
    }),

  connect: superAdminOnly
    .route({ method: 'POST', path: '/admin/marketplace/connect' })
    .output(marketplaceConnectedOutput)
    .input(marketplaceConnectInput)
    .handler(async ({ input, context }) => {
      const connection = await marketplaceService.connect({ ...input, name: context.shop.name })
      return { connected: Boolean(connection?.instanceKey) }
    }),

  sync: superAdminOnly
    .route({ method: 'POST', path: '/admin/marketplace/sync' })
    .output(okOutput)
    .handler(async () => {
      await marketplaceService.sync()
      return { ok: true }
    }),

  disconnect: superAdminOnly
    .route({ method: 'POST', path: '/admin/marketplace/disconnect' })
    .output(okOutput)
    .handler(async () => {
      found(await marketplaceService.disconnect())
      return { ok: true }
    }),
}

// Apps registered on this ShopNex install, installable by every shop (super admins)
export const appRegistry = {
  list: superAdminOnly
    .route({ method: 'GET', path: '/admin/app-registry' })
    .output(z.array(appOutput))
    .handler(() => appService.listApps()),

  // The response is the only time `privateKey` is returned
  register: superAdminOnly
    .route({ method: 'POST', path: '/admin/app-registry' })
    .output(appRegisteredOutput)
    .input(appInput)
    .handler(({ input, context }) => appService.registerApp(input, context.user.id)),

  update: superAdminOnly
    .route({ method: 'PATCH', path: '/admin/app-registry/{id}' })
    .output(appOutput)
    .input(id.extend(appInput.partial().shape))
    .handler(async ({ input: { id, ...patch } }) => found(await appService.updateApp(id, patch))),

  // Uninstalls it from every shop
  delete: superAdminOnly
    .route({ method: 'DELETE', path: '/admin/app-registry/{id}' })
    .output(appOutput)
    .input(id)
    .handler(async ({ input }) => found(await appService.deleteApp(input.id))),

  // A new key pair; the old private key stops working right away
  rotateKey: superAdminOnly
    .route({ method: 'POST', path: '/admin/app-registry/{id}/rotate-key' })
    .output(appRegisteredOutput)
    .input(id)
    .handler(async ({ input }) => found(await appService.rotateKey(input.id))),
}

// An app's own storage on each shop it's installed on (settings, its provider API keys…). Only the app's own
// token reaches it; staff never see it. Values are any JSON up to 64 KB, at most 100 keys.
const appToken = adminOrToken.use(({ context, next }) => {
  if (!context.token?.appId) throw new ORPCError('FORBIDDEN', { message: "Only an app's own token can use app data" })
  return next({ context: { token: context.token } })
})
const dataKey = z.object({ key: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/) })

export const appData = {
  list: appToken
    .route({ method: 'GET', path: '/admin/app-data' })
    .output(z.array(appDataItemOutput))
    .handler(({ context }) => appService.listAppData(context.token)),

  get: appToken
    .route({ method: 'GET', path: '/admin/app-data/{key}' })
    .output(appDataValueOutput)
    .input(dataKey)
    .handler(async ({ input, context }) => found(await appService.getAppData(context.token, input.key))),

  set: appToken
    .route({ method: 'PUT', path: '/admin/app-data/{key}' })
    .output(appDataItemOutput)
    .input(dataKey.extend({ value: z.json() }))
    .handler(({ input, context }) => appService.setAppData(context.token, input.key, input.value)),

  delete: appToken
    .route({ method: 'DELETE', path: '/admin/app-data/{key}' })
    .output(appDataKeyOutput)
    .input(dataKey)
    .handler(async ({ input, context }) => found(await appService.deleteAppData(context.token, input.key))),
}

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange'

// OAuth 2.0 token endpoint for apps, called from the app's backend. JSON or form-encoded. The app
// authenticates with a client assertion (RFC 7523) signed by its key, addressed to this instance's origin;
// no client secret ever reaches us. Errors carry `data.error` (invalid_client, invalid_grant).
//   authorization_code   code + redirect_uri → long-lived token (sk_…)
//   token-exchange       subject_token = session token from the embedded admin page → 1-hour token (RFC 8693)
//   client_credentials   shop_id → 1-hour token for the app's installation there (background work)
export const oauth = {
  token: pub
    .route({ method: 'POST', path: '/oauth/token' })
    .input(
      z.object({
        grant_type: z.enum(['authorization_code', TOKEN_EXCHANGE, 'client_credentials']).default('authorization_code'),
        client_id: z.string().min(1).max(200),
        client_assertion_type: z.literal(CLIENT_ASSERTION_TYPE),
        client_assertion: z.string().min(1).max(4000),
        code: z.string().min(1).max(200).optional(),
        redirect_uri: z.string().min(1).max(2000).optional(),
        subject_token: z.string().min(1).max(4000).optional(),
        subject_token_type: z.string().optional(),
        shop_id: z.string().min(1).max(200).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const client = { clientId: input.client_id, clientAssertion: input.client_assertion }
      const missing = (name: string) =>
        new ORPCError('BAD_REQUEST', { message: `${name} is required`, data: { error: 'invalid_request' } })

      if (input.grant_type === 'authorization_code') {
        if (!input.code || !input.redirect_uri) throw missing('code and redirect_uri')
        const result = await appService.exchangeCode({ ...client, code: input.code, redirectUri: input.redirect_uri })
        return {
          access_token: result.accessToken,
          token_type: 'bearer' as const,
          scope: result.scopes.join(','),
          shop_id: result.shopId,
          installation_id: result.installationId,
        }
      }

      const result =
        input.grant_type === TOKEN_EXCHANGE
          ? await appService.exchangeSessionToken({
              ...client,
              subjectToken: input.subject_token ?? throwError(missing('subject_token')),
            })
          : await appService.clientCredentials({ ...client, shopId: input.shop_id ?? throwError(missing('shop_id')) })
      return {
        access_token: result.accessToken,
        token_type: 'bearer' as const,
        expires_in: result.expiresIn,
        scope: result.scopes.join(','),
        shop_id: result.shopId,
        installation_id: result.installationId,
      }
    }),

  // This instance's public keys: apps check session tokens and payments requests against them
  jwks: pub.route({ method: 'GET', path: '/oauth/jwks' }).handler(() => jwks()),
}

function throwError(error: Error): never {
  throw error
}

// Public: the app marketplace fetches this while we connect, to verify this instance's URL
export const marketplace = {
  challenge: pub
    .route({ method: 'GET', path: '/marketplace/challenge' })
    .output(z.object({ challenge: z.string() }))
    .handler(async () => {
      const challenge = await marketplaceService.pendingChallenge()
      if (!challenge) throw new ORPCError('NOT_FOUND', { message: 'No connection in progress' })
      return { challenge }
    }),
}
