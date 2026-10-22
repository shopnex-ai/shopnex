// First-run setup. A fresh install has no users: the admin sends everyone to /admin/setup, where the
// first account is created as platform super admin and owner of the default shop.
// Like WordPress/Ghost, whoever reaches a fresh install first can claim it — finish setup right after deploying.
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { DEFAULT_SHOP_ID, addMember, ensureDefaultShop, updateShop } from '@shopnex/tenancy'
import { auth } from './index'
import { SUPER_ADMIN_ROLE } from './roles'
import { withSignUpAllowed } from './sign-up-policy'

export type SetupInput = {
  name: string
  email: string
  password: string
  shopName: string
  currency: string
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupError'
  }
}

// Arbitrary app-wide key: serializes concurrent setup attempts (also across processes)
const SETUP_LOCK_KEY = 74_206_001

// Once true it stays true, so only a fresh install pays for the query
let complete = false

export async function isSetupComplete() {
  if (complete) return true
  const [row] = await db.select({ id: schema.user.id }).from(schema.user).limit(1)
  complete = Boolean(row)
  return complete
}

export async function completeSetup(input: SetupInput) {
  const client = await db.$client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [SETUP_LOCK_KEY])
    if (await isSetupComplete()) throw new SetupError('Setup is already complete — sign in instead')

    await ensureDefaultShop()
    await updateShop(DEFAULT_SHOP_ID, { name: input.shopName, currency: input.currency })

    const { user } = await withSignUpAllowed(() =>
      auth.api.signUpEmail({ body: { name: input.name, email: input.email, password: input.password } }),
    )
    await db.update(schema.user).set({ role: SUPER_ADMIN_ROLE }).where(eq(schema.user.id, user.id))
    // First member of the shop, so owner
    await addMember(DEFAULT_SHOP_ID, user.id)

    complete = true
    return user
  } finally {
    await client.query('select pg_advisory_unlock($1)', [SETUP_LOCK_KEY]).catch(() => {})
    client.release()
  }
}
