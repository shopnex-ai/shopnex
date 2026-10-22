// Helpers for end-to-end tests. They talk to a running app over HTTP (`pnpm dev`, APP_URL) and use the
// services directly for setup that needs a staff session. Everything a test creates is recorded on a
// Fixtures object and removed by cleanup(), so runs leave the dev database as they found it
// (stock restocked, order counter and shop settings restored).
import assert from 'node:assert/strict'
import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { instanceUrl } from '@shopnex/apps'
import { checkoutSettings } from '@shopnex/cart'
import { db, schema } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { CLIENT_ASSERTION_TYPE, createClientAssertion } from '@shopnex/marketplace-sdk/keys'
import { createApiToken, getShopById, type ApiScope } from '@shopnex/tenancy'

export const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
export const API = `${APP_URL}/api/v1`
export const SHOP = 'default'

export type Response = { status: number; body: any }

export async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json().catch(() => null)) as any } satisfies Response
}

/** Asserts the status (default 200) and returns the body */
export function ok(r: Response, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.body))
  return r.body
}

/**
 * An app's access token from POST /oauth/token, authenticated with a client assertion signed by its key.
 * `grant`: { shop_id } (client credentials) or { subject_token } (token exchange).
 */
export async function appToken(
  clientId: string,
  privateKey: string,
  grant: { shop_id: string } | { subject_token: string },
) {
  const r = await oauthToken(clientId, privateKey, grant)
  return ok(r).access_token as string
}

export async function oauthToken(
  clientId: string,
  privateKey: string,
  grant: { shop_id: string } | { subject_token: string },
  audience?: string,
) {
  return call('POST', '/oauth/token', {
    grant_type: 'shop_id' in grant ? 'client_credentials' : 'urn:ietf:params:oauth:grant-type:token-exchange',
    ...grant,
    client_id: clientId,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: await createClientAssertion(privateKey, clientId, audience ?? (await instanceUrl())),
  })
}

/** Fails fast with a clear message when the app isn't running */
export async function requireApp() {
  const health = await fetch(`${API}/health`).catch(() => null)
  assert.ok(health?.ok, `App not reachable at ${APP_URL} — start it with \`pnpm dev\` (or set APP_URL)`)
}

/** Active variants that can be bought in quantity (stock untracked or ≥ 10), cheapest first */
export async function sellableVariants(count: number) {
  const rows = await db
    .select({ id: schema.productVariants.id, priceCents: schema.productVariants.priceCents })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(
      and(
        eq(schema.products.shopId, SHOP),
        eq(schema.products.status, 'active'),
        or(isNull(schema.productVariants.inventoryQuantity), gte(schema.productVariants.inventoryQuantity, 10)),
        gte(schema.productVariants.priceCents, 500),
      ),
    )
    .orderBy(asc(schema.productVariants.priceCents))
  // Distinct prices make the expected numbers easy to tell apart
  const picked = rows.filter((r, i) => rows.findIndex((o) => o.priceCents === r.priceCents) === i).slice(0, count)
  assert.equal(picked.length, count, `Need ${count} active, in-stock variants with different prices in the shop`)
  return picked
}

export class Fixtures {
  readonly email = `e2e-${Date.now()}@example.com`
  private shopBefore?: Awaited<ReturnType<typeof getShopById>>
  private carts: string[] = []
  private orders: string[] = []
  private discounts: string[] = []
  private taxRates: string[] = []
  private shippingRates: string[] = []
  private tokens: string[] = []

  async init() {
    this.shopBefore = await getShopById(SHOP)
    assert.ok(this.shopBefore, `Shop "${SHOP}" not found`)
  }

  /** Bearer headers for an API token with these scopes */
  async token(scopes: ApiScope[]) {
    const token = await createApiToken(SHOP, { name: 'e2e', scopes, createdById: null })
    this.tokens.push(token.id)
    return { authorization: `Bearer ${token.token}` }
  }

  /** An order placed outside complete() (cleaned up like the others) */
  order(id: string) {
    if (!this.orders.includes(id)) this.orders.push(id)
  }

  discount(id: string) {
    this.discounts.push(id)
  }

  taxRate(id: string) {
    this.taxRates.push(id)
  }

  async shippingRate(priceCents: number) {
    const rate = await checkoutSettings.createShippingRate(SHOP, {
      name: 'E2E shipping',
      priceCents,
      freeAboveCents: null,
      active: true,
    })
    this.shippingRates.push(rate.id)
    return rate
  }

  async cart(lines: { merchandiseId: string; quantity: number }[], discountCode?: string) {
    let cart = ok(await call('POST', '/storefront/carts', { lines }))
    this.carts.push(cart.id)
    if (discountCode) {
      cart = ok(await call('PUT', `/storefront/carts/${cart.id}/discount-codes`, { discountCodes: [discountCode] }))
    }
    return cart
  }

  /** checkout.complete as this run's buyer; successful orders are tracked for cleanup */
  async complete(cartId: string, shippingAddress: { countryCode: string; province?: string }, shippingRateId?: string) {
    const r = await call('POST', `/storefront/carts/${cartId}/complete`, {
      email: this.email,
      shippingRateId,
      shippingAddress: { lastName: 'Tester', address1: '1 Main St', city: 'Somewhere', ...shippingAddress },
    })
    if (r.status === 200) this.orders.push(r.body.orderId)
    return r
  }

  // Restoring the order counter assumes nobody else placed an order meanwhile (fine on a dev database)
  async cleanup() {
    for (const id of this.orders) {
      await orderService.cancel(SHOP, id, { reason: 'other', restock: true }).catch(() => {})
    }
    if (this.carts.length) await db.delete(schema.carts).where(inArray(schema.carts.token, this.carts))
    if (this.orders.length) await db.delete(schema.orders).where(inArray(schema.orders.id, this.orders))
    await db.delete(schema.customers).where(eq(schema.customers.email, this.email))
    if (this.discounts.length) await db.delete(schema.discounts).where(inArray(schema.discounts.id, this.discounts))
    if (this.taxRates.length) await db.delete(schema.taxRates).where(inArray(schema.taxRates.id, this.taxRates))
    if (this.shippingRates.length) {
      await db.delete(schema.shippingRates).where(inArray(schema.shippingRates.id, this.shippingRates))
    }
    if (this.tokens.length) await db.delete(schema.apiTokens).where(inArray(schema.apiTokens.id, this.tokens))
    if (this.shopBefore) {
      const { taxesIncluded, taxShipping, nextOrderNumber } = this.shopBefore
      await db
        .update(schema.shops)
        .set({ taxesIncluded, taxShipping, nextOrderNumber })
        .where(eq(schema.shops.id, SHOP))
    }
  }
}

/** Call once per test file, after all tests (closes the pool so the process can exit) */
export const closeDb = () => db.$client.end()
