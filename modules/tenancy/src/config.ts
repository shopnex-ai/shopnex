import { parseRootDomain } from './subdomains'

export type TenancyMode = 'single' | 'multi'

// single: one shop (created automatically), every user belongs to it.
// multi:  shops are resolved by storefront host / the admin's active shop.
export const TENANCY_MODE: TenancyMode = process.env.TENANCY_MODE === 'multi' ? 'multi' : 'single'

export const isMultiTenant = TENANCY_MODE === 'multi'

// Multi mode: every shop is also served at <slug>.ROOT_DOMAIN, no DNS step (needs wildcard DNS and TLS for
// *.ROOT_DOMAIN pointing at the storefront). Unset: shops are reachable only on their verified domains.
export const ROOT_DOMAIN = isMultiTenant
  ? parseRootDomain(process.env.ROOT_DOMAIN, process.env.APP_URL ?? process.env.BETTER_AUTH_URL)
  : null

// Fixed id so the migration and runtime agree on the default shop
export const DEFAULT_SHOP_ID = 'default'

// Self-serve demo/SaaS: anyone can create an account and their own shop. Only meaningful in multi mode;
// otherwise accounts stay invitation-only.
export const isOpenSignup = isMultiTenant && process.env.OPEN_SIGNUP === 'true'
