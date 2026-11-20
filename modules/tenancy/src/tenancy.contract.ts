// The shapes of this module's API: what the Settings → Shop, Staff, Domains and API tokens routes take and answer. Plain Zod,
// no oRPC or server code.
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { STAFF_ROLES, shopDomains, shopInvitations, shopMembers } from './tenancy.schema'
import { API_SCOPES, apiTokens, shops } from '@shopnex/core/schema'

const scopes = z.array(z.enum(API_SCOPES))

// ISO 4217 codes the runtime knows how to format (Node and browsers agree on this list)
export const CURRENCY_CODES: readonly string[] = Intl.supportedValuesOf('currency')

export const shopInput = createInsertSchema(shops, {
  name: (s) => s.trim().min(1).max(100),
  // Prices are stored in the shop's currency; existing orders keep the currency they were placed in
  currency: () => z.string().refine((c) => CURRENCY_CODES.includes(c), 'Choose a currency'),
  // Checkout's "Continue shopping" link
  storefrontUrl: () => z.url({ protocol: /^https?$/ }).max(500),
  // The homepage's <title> and meta description; empty = the shop name, none
  seoTitle: (s) => s.trim().max(200),
  seoDescription: (s) => s.trim().max(500),
  // Hours until an unpaid order nobody is paying is cancelled and restocked; null = never (up to a year)
  unpaidOrderExpiryHours: () => z.number().int().min(1).max(8760).nullable(),
  // Printed on invoices; empty = not set (the invoice falls back to the shop name and says what is missing)
  legalName: (s) => s.trim().max(150),
  businessAddress: (s) => s.trim().max(500),
  taxId: (s) => s.trim().max(50),
  // ISO 3166-1 alpha-2, upper case
  shipToCountries: () => z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
}).pick({
  name: true,
  currency: true,
  storefrontUrl: true,
  seoTitle: true,
  seoDescription: true,
  taxesIncluded: true,
  taxShipping: true,
  unpaidOrderExpiryHours: true,
  legalName: true,
  businessAddress: true,
  taxId: true,
  cookieBanner: true,
  shipToCountries: true,
})

export const shopOutput = createSelectSchema(shops).extend({
  /** True when the Storefront URL is derived from the shop's domains and can't be set (multi-tenant mode) */
  storefrontUrlManaged: z.boolean(),
})

// Shop staff (Admin → Staff)
export const staffRole = z.enum(STAFF_ROLES)
export const staffInviteInput = z.object({ email: z.email(), role: staffRole })

export const staffListOutput = z.object({
  members: z.array(
    createSelectSchema(shopMembers).omit({ organizationId: true }).extend({ name: z.string(), email: z.string() }),
  ),
  invitations: z.array(createSelectSchema(shopInvitations)),
})
export const invitationOutput = createSelectSchema(shopInvitations)
export const memberOutput = createSelectSchema(shopMembers)

// Settings → Domains. Normalised (scheme, path, case) and validated by the tenancy module.
export const domainInput = z.object({ domain: z.string().trim().min(1).max(300) })

const domainOutput = createSelectSchema(shopDomains)
  .pick({ id: true, domain: true, verifiedAt: true, createdAt: true })
  .extend({
    /** verifiedAt is set */
    verified: z.boolean(),
    /** The DNS record that proves ownership */
    record: z.object({ type: z.literal('TXT'), name: z.string(), value: z.string() }),
  })
export const domainsListOutput = z.object({ routing: z.boolean(), domains: z.array(domainOutput) })
export const domainVerifiedOutput = z.object({ verified: z.boolean(), domain: domainOutput })
export const domainCreatedOutput = domainOutput

// Settings → API tokens
export const apiTokenInput = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Grant at least one permission'),
})

export const apiTokenOutput = createSelectSchema(apiTokens, { scopes }).omit({ tokenHash: true })
export const apiTokenCreatedOutput = apiTokenOutput.extend({ token: z.string() })

/** Deleting something: `{ ok: true }` */
export const deletedOutput = z.object({ ok: z.boolean() })
