// Storefront domains (multi mode): a shop claims a host, then proves it controls it with a DNS TXT record.
// Only verified domains resolve to the shop (see getShopByDomain).
import { randomUUID } from 'node:crypto'
import { Resolver, resolveTxt } from 'node:dns/promises'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'

export type DomainErrorCode = 'INVALID_DOMAIN' | 'DOMAIN_TAKEN' | 'DOMAIN_NOT_FOUND'

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const MAX_DOMAINS_PER_SHOP = 20

// The record the shop adds at its DNS provider: _shopnex-challenge.<domain> TXT <token>
export const challengeHost = (domain: string) => `_shopnex-challenge.${domain}`

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

// Accepts what people paste ("https://Shop.Acme.com/"), returns the bare lowercase host. Throws on anything that
// isn't a public-looking hostname: IPs, single labels, ports and paths are rejected.
export function normalizeDomain(input: string) {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
  const labels = host.split('.')
  const valid =
    host.length <= 253 &&
    labels.length >= 2 &&
    labels.every((l) => LABEL.test(l)) &&
    !/^\d+$/.test(labels[labels.length - 1]!) // all-numeric TLD: an IP address
  if (!valid) throw new DomainError('INVALID_DOMAIN', 'Enter a domain like shop.example.com')
  return host
}

// The admin's own host serves the dashboard and hosted checkout: no shop may claim it
function appHost() {
  try {
    return new URL(process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').hostname
  } catch {
    return null
  }
}

export async function listDomains(shopId: string) {
  return db
    .select()
    .from(schema.shopDomains)
    .where(eq(schema.shopDomains.shopId, shopId))
    .orderBy(asc(schema.shopDomains.createdAt))
}

export async function addDomain(shopId: string, input: string) {
  const domain = normalizeDomain(input)
  if (domain === appHost()) throw new DomainError('DOMAIN_TAKEN', 'This is the address of the admin itself')

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.shopDomains).where(eq(schema.shopDomains.domain, domain))
    if (existing) {
      if (existing.shopId === shopId) throw new DomainError('DOMAIN_TAKEN', 'You already added this domain')
      // Another shop's claim that was never verified carries no rights; only a verified one blocks
      if (existing.verifiedAt) throw new DomainError('DOMAIN_TAKEN', 'This domain is used by another shop')
      await tx.delete(schema.shopDomains).where(eq(schema.shopDomains.id, existing.id))
    }
    const count = await tx.$count(schema.shopDomains, eq(schema.shopDomains.shopId, shopId))
    if (count >= MAX_DOMAINS_PER_SHOP) {
      throw new DomainError('INVALID_DOMAIN', `A shop can have up to ${MAX_DOMAINS_PER_SHOP} domains`)
    }
    const [row] = await tx.insert(schema.shopDomains).values({ id: randomUUID(), shopId, domain }).returning()
    return row!
  })
}

export async function removeDomain(shopId: string, id: string) {
  const rows = await db
    .delete(schema.shopDomains)
    .where(and(eq(schema.shopDomains.id, id), eq(schema.shopDomains.shopId, shopId)))
    .returning({ id: schema.shopDomains.id })
  if (rows.length === 0) throw new DomainError('DOMAIN_NOT_FOUND', 'Domain not found')
}

// Public resolvers first: the answer should be what the internet sees, not a local resolver's cache (which can
// keep a "not found" from before the record was added for the length of the zone's negative TTL) or a split-horizon
// view. The system resolver is the fallback for hosts that can't reach them.
const PUBLIC_DNS = ['1.1.1.1', '8.8.8.8']

async function lookupTxt(name: string) {
  const attempts = [
    () => {
      const resolver = new Resolver({ timeout: 3000, tries: 1 })
      resolver.setServers(PUBLIC_DNS)
      return resolver.resolveTxt(name)
    },
    () => resolveTxt(name),
  ]
  for (const attempt of attempts) {
    const records = await attempt().catch(() => [] as string[][])
    if (records.length > 0) return records
  }
  return []
}

// Looks up the TXT record. A missing record is a normal outcome (DNS not set up yet or still propagating),
// so it comes back as `verified: false` rather than an error.
export async function verifyDomain(shopId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.shopDomains)
    .where(and(eq(schema.shopDomains.id, id), eq(schema.shopDomains.shopId, shopId)))
  if (!row) throw new DomainError('DOMAIN_NOT_FOUND', 'Domain not found')
  if (row.verifiedAt) return { domain: row, verified: true }

  const records = await lookupTxt(challengeHost(row.domain))
  // A long value can be split into several strings within one record
  const found = records.some((chunks) => chunks.join('').trim() === row.verificationToken)
  if (!found) return { domain: row, verified: false }

  const [updated] = await db
    .update(schema.shopDomains)
    .set({ verifiedAt: new Date() })
    .where(and(eq(schema.shopDomains.id, row.id), isNull(schema.shopDomains.verifiedAt)))
    .returning()
  return { domain: updated ?? { ...row, verifiedAt: new Date() }, verified: true }
}
