// Accounts are created only by: the setup wizard, someone with a pending shop invitation, or server code
// that opts in (create-super-admin). Enforced in a Better Auth hook, so it covers email and OAuth sign-up.
import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, gt, sql } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { db, schema } from '@shopnex/db'

const trusted = new AsyncLocalStorage<true>()

/** Runs `fn` with sign-up allowed for any email (setup, CLI scripts) */
export function withSignUpAllowed<T>(fn: () => Promise<T>) {
  return trusted.run(true, fn)
}

export async function assertSignUpAllowed(email: string) {
  if (trusted.getStore()) return
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
  if (!invitation)
    throw new APIError('FORBIDDEN', { message: 'Sign-up is by invitation only. Ask a shop owner to invite you.' })
}
