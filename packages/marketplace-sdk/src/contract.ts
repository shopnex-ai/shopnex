// Marketplace API v1 contract. The marketplace service implements it; Shopnex instances and apps
// consume it. Additive changes only: new procedures/fields/optional inputs; never rename or remove.
//
// Who calls what:
//   instance  connect (once) → catalog (apps and theme styles) / installations.sync (Bearer mk_… instance key)
//   app       installations.verify (client_id + client assertion): "is this install real?"
import { oc, type InferContractRouterInputs, type InferContractRouterOutputs } from '@orpc/contract'
import { z } from 'zod'

// Must match the Shopnex Admin API scopes (API_SCOPES in @shopnex/db), except the payment session scopes:
// payments apps are custom or bundled apps until marketplace listings are reviewed
export const SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'write_orders',
  'read_customers',
  'write_customers',
  'read_discounts',
  'write_discounts',
] as const
export const Scope = z.enum(SCOPES)
export type Scope = z.infer<typeof Scope>

// An instance's public origin, e.g. https://shop.example.com (no path)
export const InstanceUrl = z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin)

export const CatalogApp = z.object({
  /** Marketplace app id: stable across instances */
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  developerName: z.string(),
  /**
   * The app's UI. Managed apps (no redirectUrls) are installed in the admin and opened embedded here; others
   * get ?shop_id=…&instance=… and start OAuth from there.
   */
  appUrl: z.string(),
  redirectUrls: z.array(z.string()),
  scopes: z.array(Scope),
  clientId: z.string(),
  /** Ed25519 public key (base64url): the instance checks the app's client assertions with it */
  publicKey: z.string().nullable(),
  /** Listing page on the marketplace */
  listingUrl: z.string(),
  updatedAt: z.coerce.date(),
})
export type CatalogApp = z.infer<typeof CatalogApp>

// Same rule as Shopnex theme ids (ThemeDefinition.id)
export const ThemeId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'Lowercase letters, digits, - and _')

/**
 * A theme style: a look built on a theme that storefronts include (`baseThemeId`, e.g. "maison"), as a
 * theme document: global settings, then each page's sections. No code ships, so any instance whose
 * storefront includes the base theme can use it. Adding one creates a copy in the shop's theme library.
 */
export const CatalogTheme = z.object({
  /** Marketplace theme id: stable across instances */
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string().nullable(),
  developerName: z.string(),
  baseThemeId: ThemeId,
  /** Desktop screenshot of a store using it */
  screenshotUrl: z.string().nullable(),
  /**
   * A ThemeDocument (@shopnex/storefront-sdk/theme). Instances validate it and drop its `code` settings
   * (custom CSS/HTML: a style never ships code); the storefront resolves the rest against the base theme's
   * definition (unknown sections and invalid settings fall back to defaults).
   */
  document: z.unknown(),
  /** Listing page on the marketplace */
  listingUrl: z.string(),
  updatedAt: z.coerce.date(),
})
export type CatalogTheme = z.infer<typeof CatalogTheme>

export const InstalledApp = z.object({
  appId: z.uuid(),
  shopId: z.string().min(1).max(200),
  scopes: z.array(Scope),
  installedAt: z.coerce.date(),
})
export type InstalledApp = z.infer<typeof InstalledApp>

export const marketplaceErrorMap = {
  UNAUTHORIZED: {}, // missing/invalid instance key or client assertion
  // connect: the marketplace couldn't fetch the challenge from the instance's URL, or it didn't match
  INSTANCE_UNVERIFIED: { status: 400 },
}

export const marketplaceContract = {
  instances: oc.tag('Instances').router({
    /**
     * Connects a Shopnex instance. The instance first publishes `challenge` at
     * GET {url}/api/v1/marketplace/challenge; the marketplace fetches it to prove the URL is really this
     * instance, then returns the instance key (shown once).
     */
    connect: oc
      .route({ method: 'POST', path: '/instances' })
      .input(
        z.object({
          url: InstanceUrl,
          name: z.string().trim().max(200).optional(),
          challenge: z.string().min(16).max(200),
          shopnexVersion: z.string().max(50).optional(),
        }),
      )
      .errors({ INSTANCE_UNVERIFIED: marketplaceErrorMap.INSTANCE_UNVERIFIED })
      .output(z.object({ instanceId: z.uuid(), instanceKey: z.string() })),

    /** Stops syncing; the marketplace marks this instance's installations as uninstalled */
    disconnect: oc
      .route({ method: 'POST', path: '/instance/disconnect' })
      .errors({ UNAUTHORIZED: marketplaceErrorMap.UNAUTHORIZED })
      .output(z.object({ ok: z.literal(true) })),
  }),

  catalog: oc.tag('Catalog').router({
    /** Every published app, with what the instance needs to run its OAuth flow, and every published theme style */
    list: oc
      .route({ method: 'GET', path: '/catalog' })
      .errors({ UNAUTHORIZED: marketplaceErrorMap.UNAUTHORIZED })
      // `themes` was added later: older marketplaces don't send it
      .output(z.object({ apps: z.array(CatalogApp), themes: z.array(CatalogTheme).default([]) })),
  }),

  installations: oc.tag('Installations').router({
    /**
     * The instance's full list of marketplace-app installations (every shop). Anything missing from it is
     * marked uninstalled, so a missed report heals on the next sync.
     */
    sync: oc
      .route({ method: 'PUT', path: '/instance/installations' })
      .input(z.object({ installations: z.array(InstalledApp).max(10_000) }))
      .errors({ UNAUTHORIZED: marketplaceErrorMap.UNAUTHORIZED })
      .output(z.object({ ok: z.literal(true) })),

    /**
     * For apps: is my app installed on this shop of this instance (as the instance reported)? Call it after
     * the token exchange before trusting a new install, since anyone can run a Shopnex instance.
     */
    verify: oc
      .route({ method: 'POST', path: '/installations/verify' })
      .input(
        z.object({
          client_id: z.string().min(1),
          /** Signed with the app's key, addressed to the marketplace's origin (createClientAssertion) */
          client_assertion: z.string().min(1).max(4000),
          instance_url: InstanceUrl,
          shop_id: z.string().min(1),
        }),
      )
      .errors({ UNAUTHORIZED: marketplaceErrorMap.UNAUTHORIZED })
      .output(
        z.object({
          installed: z.boolean(),
          scopes: z.array(Scope),
          installedAt: z.coerce.date().nullable(),
          /** The instance's marketplace id (null when it isn't connected) */
          instanceId: z.uuid().nullable(),
        }),
      ),
  }),
}

export type MarketplaceContract = typeof marketplaceContract
export type MarketplaceInputs = InferContractRouterInputs<MarketplaceContract>
export type MarketplaceOutputs = InferContractRouterOutputs<MarketplaceContract>
