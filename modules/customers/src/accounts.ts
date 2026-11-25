// Customer accounts: sign in to a shop's storefront with a code emailed to the customer. Proving the mailbox is what
// links the login to the shop's customer record, so guests who ordered before get their orders back. The session token is
// opaque to the storefront, which keeps it in a cookie and sends it back with each request.
//
// Customers are not Better Auth users (GHSA-w9q2-8c32-gmhm): staff and customers used to share its user table, so a code
// issued by one shop (whose SMTP the owner controls) signed in as the same address anywhere, staff included. Here a code
// and a session belong to one shop, and neither is a staff session.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import { takeRate } from '@shopnex/auth'
import { type Conn } from '@shopnex/db'
import { shopnexSecret } from '@shopnex/db/secrets'
import * as customers from './customers'
import { type Customer, customerLoginCodes, customerSessions, customers as customersTable } from './customers.schema'

export const LOGIN_CODE_LENGTH = 6
/** Seconds a code works; the email says so (LOGIN_CODE_MINUTES in @shopnex/email) */
export const LOGIN_CODE_TTL_S = 10 * 60
/** Wrong guesses a code takes before it is spent */
export const LOGIN_CODE_ATTEMPTS = 5
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000

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

interface Visitor {
  ip?: string | null
}

/** Counts one use of each limit in order and stops at the first one that is used up: the seconds to wait, or null */
async function overLimit(limits: [key: string, max: number][]) {
  for (const [key, max] of limits) {
    const waitS = await takeRate(key, max, WINDOW_MS)
    if (waitS !== null) return waitS
  }
  return null
}

// Hashes are keyed with the instance secret and name what they protect, so a code hash can't be replayed as a token hash
const digest = (purpose: string, value: string) =>
  createHmac('sha256', shopnexSecret()).update(`${purpose}:${value}`).digest('hex')
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const codeHash = (shopId: string, email: string, code: string) =>
  digest('customer-code', `${shopId}\n${email}\n${code}`)
const tokenHash = (token: string) => digest('customer-token', token)

/** Delivers a sign-in code to an address (the storefront route passes email's sendLoginCode: customers sits below email) */
export type SendLoginCode = (to: string, code: string) => Promise<void>

/**
 * Sends a sign-in code through `send`. Says nothing about whether the address has an account (a new customer gets one on
 * sign-in). What `send` throws (EMAIL_OFF when the shop can't send email) is rethrown as it is.
 */
export async function requestLoginCode(
  shopId: string,
  rawEmail: string,
  send: SendLoginCode,
  conn: Conn,
  visitor: Visitor = {},
) {
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
  const code = randomInt(0, 10 ** LOGIN_CODE_LENGTH)
    .toString()
    .padStart(LOGIN_CODE_LENGTH, '0')
  const values = {
    codeHash: codeHash(shopId, email, code),
    attempts: 0,
    expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_S * 1000),
    createdAt: new Date(),
  }
  // One code per shop and address: asking again replaces it (and gives five new guesses)
  await conn
    .insert(customerLoginCodes)
    .values({ shopId, email, ...values })
    .onConflictDoUpdate({ target: [customerLoginCodes.shopId, customerLoginCodes.email], set: values })
  try {
    await send(email, code)
  } catch (error) {
    // Nothing was delivered, so nothing should be left to guess
    await conn
      .delete(customerLoginCodes)
      .where(and(eq(customerLoginCodes.shopId, shopId), eq(customerLoginCodes.email, email)))
    throw error
  }
}

/** The customer's record in this shop, created when this is the first time the address is seen */
async function findOrCreateCustomer(shopId: string, email: string, conn: Conn): Promise<Customer> {
  const existing = await customers.getByEmail(shopId, email, conn)
  if (existing) return existing
  const created = await customers.create(shopId, { email }, conn)
  // Lost a race with checkout creating the same customer: take that one
  return created ?? findOrCreateCustomer(shopId, email, conn)
}

/** Checks the code and starts a session. `token` is what the storefront sends back as the customer token. */
export async function verifyLoginCode(
  shopId: string,
  rawEmail: string,
  code: string,
  conn: Conn,
  visitor: Visitor = {},
) {
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
  const invalid = () => new AccountError('INVALID_CODE', 'That code is wrong or has expired')
  if (!EMAIL.test(email)) throw invalid()

  const where = and(eq(customerLoginCodes.shopId, shopId), eq(customerLoginCodes.email, email))
  // Takes a guess before looking at the code, in one statement, so parallel guesses can't exceed the allowance
  const [row] = await conn
    .update(customerLoginCodes)
    .set({ attempts: sql`${customerLoginCodes.attempts} + 1` })
    .where(and(where, gt(customerLoginCodes.expiresAt, new Date())))
    .returning()
  if (!row || row.attempts > LOGIN_CODE_ATTEMPTS) {
    if (row) await conn.delete(customerLoginCodes).where(eq(customerLoginCodes.id, row.id))
    throw invalid()
  }
  if (!sameHash(row.codeHash, codeHash(shopId, email, code.trim()))) throw invalid()
  // A code works once: whoever deletes the row first gets the session
  const [spent] = await conn.delete(customerLoginCodes).where(eq(customerLoginCodes.id, row.id)).returning()
  if (!spent) throw invalid()

  const customer = await findOrCreateCustomer(shopId, email, conn)
  const token = randomBytes(32).toString('base64url')
  await conn.insert(customerSessions).values({
    shopId,
    customerId: customer.id,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return { token, customer }
}

/** The signed-in customer of this shop, or null (no token, expired, or the session belongs to another shop) */
export async function fromToken(shopId: string, token: string | null | undefined, conn: Conn) {
  if (!token) return null
  const [row] = await conn
    .select({ customer: customersTable })
    .from(customerSessions)
    .innerJoin(customersTable, eq(customersTable.id, customerSessions.customerId))
    .where(
      and(
        eq(customerSessions.tokenHash, tokenHash(token)),
        eq(customerSessions.shopId, shopId),
        gt(customerSessions.expiresAt, new Date()),
      ),
    )
  return row?.customer ?? null
}

export async function signOut(token: string, conn: Conn) {
  await conn.delete(customerSessions).where(eq(customerSessions.tokenHash, tokenHash(token)))
}

export async function updateProfile(
  shopId: string,
  customerId: string,
  patch: { name?: string; phone?: string | null },
  conn: Conn,
) {
  return customers.update(shopId, customerId, patch, conn)
}
