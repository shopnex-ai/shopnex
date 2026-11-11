// Accounts are created only by: the setup wizard, someone with a pending shop invitation, or server code
// that opts in (create-super-admin). With OPEN_SIGNUP=true (multi mode) anyone may sign up and create a shop. Enforced in a Better Auth hook, so it covers email and OAuth sign-up.
import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, gt, sql } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { db, schema } from '@shopnex/db'
import { createShop, isOpenSignup, NEW_SHOP_NAME } from '@shopnex/tenancy'
import { SIGNUP_LIMIT_MESSAGE, takeGlobalSignup } from './signup-limit'

const trusted = new AsyncLocalStorage<true>()

/** Runs `fn` with sign-up allowed for any email (setup, CLI scripts) */
export function withSignUpAllowed<T>(fn: () => Promise<T>) {
  return trusted.run(true, fn)
}

export async function assertSignUpAllowed(email: string) {
  if (trusted.getStore()) return
  if (isOpenSignup) {
    // Anyone may sign up, so cap how many accounts all visitors together can create per hour (every path ends here)
    if (takeGlobalSignup() !== null) throw new APIError('TOO_MANY_REQUESTS', { message: SIGNUP_LIMIT_MESSAGE })
    return
  }
  if (!(await hasPendingInvitation(email)))
    throw new APIError('FORBIDDEN', { message: 'Sign-up is by invitation only. Ask a shop owner to invite you.' })
}

async function hasPendingInvitation(email: string) {
  const [invitation] = await db
    .select({ id: schema.shopInvitations.id })
    .from(schema.shopInvitations)
    .where(
      and(
        eq(sql`lower(${schema.shopInvitations.email})`, email.toLowerCase()),
        eq(schema.shopInvitations.status, 'pending'),
        gt(schema.shopInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return !!invitation
}

// Open sign-up: every new account gets its own shop the moment it exists, whichever way it signed up (email, Google,
// GitHub), so there is no account without a shop to recover from. Not for the setup wizard and scripts (they make the
// shop themselves) or someone with a pending invitation (they join that shop instead).
export async function createShopForNewAccount(user: { id: string; email: string }) {
  if (!isOpenSignup || trusted.getStore() || (await hasPendingInvitation(user.email))) return
  await createShop({ ownerId: user.id, name: NEW_SHOP_NAME })
}
