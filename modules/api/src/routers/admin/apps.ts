import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { appService, marketplaceService } from '@shopnex/apps'
import { adminOrToken, shopManager, superAdminOnly } from '../../orpc'
import { appInput, marketplaceConnectInput } from './schemas'

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// Admin → Apps: what this shop has installed (owners/admins). Installing happens through OAuth (/admin/oauth/authorize).
export const apps = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/apps' })
    .handler(({ context }) => appService.listInstallations(context.shop.id)),

  // Revokes the app's token and deletes its webhooks
  uninstall: shopManager
    .route({ method: 'POST', path: '/admin/apps/{id}/uninstall' })
    .input(id)
    .handler(async ({ input, context }) => {
      const installation = found(await appService.uninstall(context.shop.id, input.id))
      void marketplaceService.reportInstallationsSoon()
      return installation
    }),

  // Embedded app page: the app's frontend asks for one through @shopnex/app-bridge (valid 60s)
  sessionToken: shopManager
    .route({ method: 'POST', path: '/admin/apps/{id}/session-token' })
    .input(id)
    .handler(async ({ input, context }) => ({
      token: await appService.createSessionToken({
        shopId: context.shop.id,
        installationId: input.id,
        userId: context.user.id,
      }),
    })),

  // App Store: marketplace apps this shop can install. Install = open the app's URL with
  // ?shop_id=…&instance=…; the app starts OAuth from there.
  store: shopManager.route({ method: 'GET', path: '/admin/app-store' }).handler(async ({ context }) => {
    const [connection, instanceUrl, apps] = await Promise.all([
      marketplaceService.getConnection(),
      marketplaceService.instanceUrl(),
      appService.listAppStore(context.shop.id),
    ])
    return { connected: Boolean(connection?.instanceKey), instanceUrl, apps }
  }),
}

// Admin → Apps → Marketplace (super admins): this instance's link to the app marketplace
export const marketplaceConnection = {
  get: superAdminOnly.route({ method: 'GET', path: '/admin/marketplace' }).handler(async () => {
    const connection = await marketplaceService.getConnection()
    if (!connection?.instanceKey) return null
    const { instanceKey: _, pendingChallenge: __, ...visible } = connection
    return visible
  }),

  connect: superAdminOnly
    .route({ method: 'POST', path: '/admin/marketplace/connect' })
    .input(marketplaceConnectInput)
    .handler(async ({ input, context }) => {
      const connection = await marketplaceService.connect({ ...input, name: context.shop.name })
      return { connected: Boolean(connection?.instanceKey) }
    }),

  sync: superAdminOnly.route({ method: 'POST', path: '/admin/marketplace/sync' }).handler(async () => {
    await marketplaceService.sync()
    return { ok: true }
  }),

  disconnect: superAdminOnly.route({ method: 'POST', path: '/admin/marketplace/disconnect' }).handler(async () => {
    found(await marketplaceService.disconnect())
    return { ok: true }
  }),
}

// Apps registered on this Shopnex install, installable by every shop (super admins)
export const appRegistry = {
  list: superAdminOnly.route({ method: 'GET', path: '/admin/app-registry' }).handler(() => appService.listApps()),

  // The response is the only time `privateKey` is returned
  register: superAdminOnly
    .route({ method: 'POST', path: '/admin/app-registry' })
    .input(appInput)
    .handler(({ input, context }) => appService.registerApp(input, context.user.id)),

  update: superAdminOnly
    .route({ method: 'PATCH', path: '/admin/app-registry/{id}' })
    .input(id.extend(appInput.partial().shape))
    .handler(async ({ input: { id, ...patch } }) => found(await appService.updateApp(id, patch))),

  // Uninstalls it from every shop
  delete: superAdminOnly
    .route({ method: 'DELETE', path: '/admin/app-registry/{id}' })
    .input(id)
    .handler(async ({ input }) => found(await appService.deleteApp(input.id))),

  // A new key pair; the old private key stops working right away
  rotateKey: superAdminOnly
    .route({ method: 'POST', path: '/admin/app-registry/{id}/rotate-key' })
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
    .handler(({ context }) => appService.listAppData(context.token)),

  get: appToken
    .route({ method: 'GET', path: '/admin/app-data/{key}' })
    .input(dataKey)
    .handler(async ({ input, context }) => found(await appService.getAppData(context.token, input.key))),

  set: appToken
    .route({ method: 'PUT', path: '/admin/app-data/{key}' })
    .input(dataKey.extend({ value: z.json() }))
    .handler(({ input, context }) => appService.setAppData(context.token, input.key, input.value)),

  delete: appToken
    .route({ method: 'DELETE', path: '/admin/app-data/{key}' })
    .input(dataKey)
    .handler(async ({ input, context }) => found(await appService.deleteAppData(context.token, input.key))),
}
