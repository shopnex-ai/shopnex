// The shapes of this module's API: what the Admin → Apps routes (the shop's installs, the registry, the marketplace link, an app's own
// data) take and answer. Plain Zod, no oRPC or server code.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { appInstallations, marketplaceConnection } from './apps.schema'
import { API_SCOPES, apps } from '@shopnex/core/schema'

const scopes = z.array(z.enum(API_SCOPES))

// Admin → Apps (registry, super admins). Redirect URLs must be absolute; https except on localhost.
const redirectUrl = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), {
    message: 'Use https (http only for localhost)',
  })
export const appInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  iconUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullable()
    .optional(),
  appUrl: z.url({ protocol: /^https?$/ }).max(2000),
  // None: a managed app (installed in the admin, gets tokens with token exchange / client credentials)
  redirectUrls: z.array(redirectUrl).max(10),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Grant at least one permission'),
})

// Admin → Apps → Marketplace
export const marketplaceConnectInput = z.object({
  marketplaceUrl: z.url({ protocol: /^https?$/ }).max(2000),
  // This instance's public origin: the marketplace and apps must be able to reach it
  publicUrl: z.url({ protocol: /^https?$/ }).max(2000),
})

export const appDataValueOutput = z.object({ key: z.string(), value: z.unknown(), updatedAt: z.date() })

export const appOutput = createSelectSchema(apps, {
  scopes,
  source: z.enum(['custom', 'marketplace', 'bundled']),
}).extend({
  managed: z.boolean(),
})
export const appInstallationOutput = createSelectSchema(appInstallations, { scopes })
export const appInstalledOutput = appInstallationOutput.extend({ app: appOutput, lastUsedAt: z.date().nullable() })
export const appCatalogOutput = z.object({
  marketplaceConnected: z.boolean(),
  instanceUrl: z.string(),
  apps: z.array(
    appOutput.extend({
      origin: z.enum(['custom', 'marketplace', 'bundled']),
      installationId: z.string().nullable(),
      installed: z.boolean(),
    }),
  ),
})
export const appRegisteredOutput = z.object({ app: appOutput, privateKey: z.string() })
export const sessionTokenOutput = z.object({ token: z.string() })
export const marketplaceConnectionOutput = createSelectSchema(marketplaceConnection)
  .pick({
    id: true,
    marketplaceUrl: true,
    publicUrl: true,
    instanceId: true,
    connectedAt: true,
    lastSyncAt: true,
    lastSyncError: true,
  })
  .nullable()
export const marketplaceConnectedOutput = z.object({ connected: z.boolean() })
export const appDataItemOutput = z.object({ key: z.string(), value: z.unknown(), updatedAt: z.date() })
export const appDataKeyOutput = z.object({ key: z.string() })

/** Deleting or toggling something: `{ ok: true }` */
export const okOutput = z.object({ ok: z.boolean() })
