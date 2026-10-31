// Helpers for end-to-end tests. They talk to a running app over HTTP (`pnpm dev`, APP_URL) and use the
// services directly for setup that needs a staff session. Everything a test creates is recorded on a
// Fixtures object and removed by cleanup(), so runs leave the dev database as they found it
// (stock restocked, order counter and shop settings restored).
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import { instanceUrl } from '@shopnex/apps'
import { checkoutSettings } from '@shopnex/cart'
import { db, schema } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { CLIENT_ASSERTION_TYPE, createClientAssertion } from '@shopnex/marketplace-sdk/keys'
import { createApiToken, createStorefrontKey, getShopById, type ApiScope } from '@shopnex/tenancy'

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

export const AUTH = `${APP_URL}/api/auth`
export const PASSWORD = 'e2e-Passw0rd!'

/** A Better Auth endpoint (sign-up, sign-in, …); `cookie` is the session cookie from an earlier response */
export async function authCall(path: string, body: unknown, cookie?: string) {
  const r = await fetch(AUTH + path, {
    method: 'POST',
    // Better Auth checks the origin of requests that carry cookies
    headers: { 'content-type': 'application/json', origin: APP_URL, ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  })
  const setCookies = r.headers.getSetCookie().map((c) => c.split(';')[0]!)
  return {
    status: r.status,
    body: (await r.json().catch(() => null)) as any,
    cookie: setCookies.length ? setCookies.join('; ') : undefined,
  }
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
  private paymentMethods: string[] = []
  private tokens: string[] = []
  private users: string[] = []
  private shops: string[] = []
  private shoppers: string[] = []
  private seq = 0
  private readonly run = randomBytes(4).toString('hex')

  async init() {
    this.shopBefore = await getShopById(SHOP)
    assert.ok(this.shopBefore, `Shop "${SHOP}" not found`)
  }

  /** Bearer headers for an API token with these scopes */
  async token(scopes: ApiScope[], shopId = SHOP) {
    return (await this.mintToken(scopes, shopId)).headers
  }

  async mintToken(scopes: ApiScope[], shopId = SHOP) {
    const token = await createApiToken(shopId, { name: 'e2e', scopes, createdById: null })
    this.tokens.push(token.id)
    return { id: token.id, token: token.token, headers: { authorization: `Bearer ${token.token}` } }
  }

  /** A token created through the API, removed with the rest */
  apiToken(id: string) {
    this.tokens.push(id)
  }

  /** A second, empty shop (removed with everything in it) */
  async shop() {
    const id = `e2e-${this.run}-${++this.seq}`
    const [shop] = await db
      .insert(schema.shops)
      .values({ id, name: `E2E shop ${id}`, slug: id })
      .returning()
    this.shops.push(id)
    return shop!
  }

  async storefrontKey(shopId: string) {
    return createStorefrontKey(shopId, 'e2e')
  }

  /** The account that owns the invitations made below (invitations need an inviter) */
  private inviter?: Promise<string>
  private inviterId() {
    this.inviter ??= (async () => {
      const id = `e2e-inviter-${this.run}`
      await db.insert(schema.user).values({ id, name: 'E2E inviter', email: `${id}@example.com` })
      this.users.push(id)
      return id
    })()
    return this.inviter
  }

  /** A pending invitation written straight to the database; `expiresInMs` < 0 for an expired one */
  async invitation(shopId: string, email: string, role: 'admin' | 'member', expiresInMs = 86400e3) {
    const id = randomBytes(24).toString('base64url')
    await db.insert(schema.shopInvitations).values({
      id,
      organizationId: shopId,
      email,
      role,
      status: 'pending',
      expiresAt: new Date(Date.now() + expiresInMs),
      inviterId: await this.inviterId(),
    })
    return id
  }

  /** Signs up (the email needs a pending invitation) and returns the session cookie */
  async signUp(email: string) {
    const r = await authCall('/sign-up/email', { name: 'E2E staff', email, password: PASSWORD })
    if (r.status === 200) this.users.push(r.body.user.id)
    return r
  }

  /** A customer who signs in with a code: their login and customer record are removed with the rest */
  shopper(label = 'shopper') {
    const email = this.mail(label)
    this.shoppers.push(email)
    return email
  }

  mail(label: string) {
    return `e2e-${label}-${++this.seq}-${this.run}@example.com`
  }

  /**
   * A signed-in staff account through the real flow: invitation → sign-up → accept.
   *   owner / admin / member: that role in the shop
   *   outsider: signed up and signed in, but a member of no shop
   *   superadmin: platform super admin, a member of no shop
   */
  async account(role: 'owner' | 'admin' | 'member' | 'outsider' | 'superadmin', shopId = SHOP) {
    const email = this.mail(role)
    const invitationId = await this.invitation(shopId, email, role === 'admin' ? 'admin' : 'member')
    const signUp = await this.signUp(email)
    assert.equal(signUp.status, 200, JSON.stringify(signUp.body))
    const id = signUp.body.user.id as string
    const cookie = signUp.cookie!
    if (role === 'outsider' || role === 'superadmin') {
      await db
        .update(schema.shopInvitations)
        .set({ status: 'canceled' })
        .where(eq(schema.shopInvitations.id, invitationId))
      if (role === 'superadmin') await db.update(schema.user).set({ role: 'superadmin' }).where(eq(schema.user.id, id))
    } else {
      const accepted = await authCall('/organization/accept-invitation', { invitationId }, cookie)
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
      if (role === 'owner') {
        await db
          .update(schema.shopMembers)
          .set({ role: 'owner' })
          .where(and(eq(schema.shopMembers.organizationId, shopId), eq(schema.shopMembers.userId, id)))
      }
    }
    const [member] = await db
      .select({ id: schema.shopMembers.id })
      .from(schema.shopMembers)
      .where(and(eq(schema.shopMembers.organizationId, shopId), eq(schema.shopMembers.userId, id)))
    return { id, email, memberId: member?.id as string, headers: { cookie } }
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

  async paymentMethod(name = 'E2E bank transfer') {
    const method = await checkoutSettings.createPaymentMethod(SHOP, {
      name,
      additionalDetails: null,
      instructions: 'Transfer the total to IBAN E2E-0000',
      active: true,
    })
    this.paymentMethods.push(method.id)
    return method
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
    if (this.paymentMethods.length) {
      await db.delete(schema.paymentMethods).where(inArray(schema.paymentMethods.id, this.paymentMethods))
    }
    await db.delete(schema.customers).where(inArray(schema.customers.email, [this.email, ...this.shoppers]))
    if (this.shoppers.length) await db.delete(schema.user).where(inArray(schema.user.email, this.shoppers))
    if (this.discounts.length) await db.delete(schema.discounts).where(inArray(schema.discounts.id, this.discounts))
    if (this.taxRates.length) await db.delete(schema.taxRates).where(inArray(schema.taxRates.id, this.taxRates))
    if (this.shippingRates.length) {
      await db.delete(schema.shippingRates).where(inArray(schema.shippingRates.id, this.shippingRates))
    }
    if (this.users.length) await db.delete(schema.user).where(inArray(schema.user.id, this.users))
    if (this.shops.length) await db.delete(schema.shops).where(inArray(schema.shops.id, this.shops))
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
