// Customer accounts: sign in to a shop's storefront with a code emailed to the customer (Better Auth emailOTP,
// see @shopnex/auth). Proving the mailbox is what links the login to the shop's customer record, so guests
// who ordered before get their orders back. The session token is opaque to the storefront, which keeps it in a
// cookie and sends it back with each request.
import { and, eq } from 'drizzle-orm'
import { auth, takeRate, withOtpSender, withOtpSignIn, withSignUpAllowed } from '@shopnex/auth'
import { db, schema } from '@shopnex/db'
import { sendLoginCode } from '@shopnex/email'
import type { Customer } from '@shopnex/db/schema'
import { emit } from '@shopnex/webhooks'
import * as customers from './customers'

export type AccountErrorCode = 'INVALID_EMAIL' | 'TOO_MANY_REQUESTS' | 'INVALID_CODE'

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AccountError'
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const normalize = (email: string) => email.trim().toLowerCase()

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` })

// Limits on emailed sign-in codes, counted in the database (takeRate): every server process shares them and a restart
// doesn't clear them. Each is a fixed window of 15 minutes. They stop a page from mailing one person over and over, one
// visitor from mailing many people, a script from draining the shop's SMTP quota, and guessing a code by asking for new
// ones. Keys carry the shop; the address and the email are hashed before they are stored. `ip` is the visitor's address
// (null when there is none worth trusting: only the other limits apply).
const WINDOW_MS = 15 * 60_000
const SEND_PER_EMAIL = 4
const SEND_PER_IP = 20
const SEND_PER_SHOP = 200
const CHECK_PER_EMAIL = 10
const CHECK_PER_IP = 30

type Visitor = { ip?: string | null }

/** Counts one use of each limit in order and stops at the first one that is used up: the seconds to wait, or null */
async function overLimit(limits: [key: string, max: number][]) {
  for (const [key, max] of limits) {
    const waitS = await takeRate(key, max, WINDOW_MS)
    if (waitS !== null) return waitS
  }
  return null
}

// Better Auth's emailOTP "promotes" an existing user whose email was never verified by deleting their
// password, OAuth links and sessions. Staff accounts made by the setup wizard or an invitation are like that, so
// signing one in with a code would lock the owner out of the admin. They use the admin's login instead.
async function isUnverifiedAccount(email: string) {
  const [existing] = await db
    .select({ emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.email, email))
  return existing !== undefined && !existing.emailVerified
}

/**
 * Emails a sign-in code. Says nothing about whether the address has an account (a new customer gets one on
 * sign-in). Throws EMAIL_OFF (EmailError) when the shop can't send email.
 */
export async function requestLoginCode(shopId: string, rawEmail: string, visitor: Visitor = {}) {
  const email = normalize(rawEmail)
  if (!EMAIL.test(email) || email.length > 254) throw new AccountError('INVALID_EMAIL', 'Enter a valid email address')
  const wait = await overLimit([
    [`login-code:email:${shopId}:${email}`, SEND_PER_EMAIL],
    ...(visitor.ip ? [[`login-code:ip:${shopId}:${visitor.ip}`, SEND_PER_IP] as [string, number]] : []),
    [`login-code:shop:${shopId}`, SEND_PER_SHOP],
  ])
  if (wait !== null) {
    throw new AccountError('TOO_MANY_REQUESTS', 'Too many codes requested. Wait a few minutes and try again.')
  }
  if (await isUnverifiedAccount(email)) {
    console.warn(`[customers] not sending a sign-in code to ${email}: it belongs to a staff account`)
    return
  }
  // Better Auth runs the sender inside the request; keep its failure (a shop with email off) to rethrow as is
  let failure: unknown
  await withOtpSender(
    async (to, code) => {
      try {
        await sendLoginCode(shopId, to, code)
      } catch (error) {
        failure = error
      }
    },
    () => auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } }),
  )
  if (failure) throw failure
}

/** The customer's record in this shop, created or linked to this login (matched by the verified email) */
async function linkCustomer(shopId: string, user: { id: string; email: string; name: string }): Promise<Customer> {
  const existing = await customers.getByEmail(shopId, user.email)
  if (existing) {
    if (existing.userId === user.id) return existing
    const [linked] = await db
      .update(schema.customers)
      .set({ userId: user.id, updatedAt: new Date() })
      .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.id, existing.id)))
      .returning()
    if (linked) await emit(db, shopId, 'customer.updated', () => linked)
    return linked ?? existing
  }
  const created = await customers.create(shopId, { email: user.email, name: user.name || null, userId: user.id })
  // Lost a race with checkout creating the same customer: link that one instead
  return created ?? linkCustomer(shopId, user)
}

/** Checks the code and starts a session. `token` is what the storefront sends back as the customer token. */
export async function verifyLoginCode(shopId: string, rawEmail: string, code: string, visitor: Visitor = {}) {
  const email = normalize(rawEmail)
  // Every attempt counts, right or wrong: each new code gives five more guesses, so this caps guessing as well
  if (EMAIL.test(email)) {
    const wait = await overLimit([
      [`login-check:email:${shopId}:${email}`, CHECK_PER_EMAIL],
      ...(visitor.ip ? [[`login-check:ip:${shopId}:${visitor.ip}`, CHECK_PER_IP] as [string, number]] : []),
    ])
    if (wait !== null)
      throw new AccountError('TOO_MANY_REQUESTS', 'Too many attempts. Wait a few minutes and try again.')
  }
  if (!EMAIL.test(email) || (await isUnverifiedAccount(email))) {
    throw new AccountError('INVALID_CODE', 'That code is wrong or has expired')
  }
  let result: Awaited<ReturnType<typeof auth.api.signInEmailOTP>>
  try {
    // Sign-up is invitation-only for staff (sign-up-policy); a customer's first sign-in is the exception
    result = await withOtpSignIn(() =>
      withSignUpAllowed(() => auth.api.signInEmailOTP({ body: { email, otp: code.trim() } })),
    )
  } catch {
    throw new AccountError('INVALID_CODE', 'That code is wrong or has expired')
  }
  const customer = await linkCustomer(shopId, result.user)
  return { token: result.token, customer }
}

/** The signed-in customer of this shop, or null (no token, expired, or the login isn't a customer here) */
export async function fromToken(shopId: string, token: string | null | undefined) {
  if (!token) return null
  const session = await auth.api.getSession({ headers: bearer(token) }).catch(() => null)
  if (!session) return null
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.userId, session.user.id)))
  return customer ?? null
}

export async function signOut(token: string) {
  await auth.api.signOut({ headers: bearer(token) }).catch(() => {})
}

export async function updateProfile(
  shopId: string,
  customerId: string,
  patch: { name?: string; phone?: string | null },
) {
  return customers.update(shopId, customerId, patch)
}
