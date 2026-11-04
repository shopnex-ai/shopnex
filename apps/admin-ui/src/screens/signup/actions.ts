import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '@shopnex/auth'
import { seedSampleProducts } from '@shopnex/catalog'
import { createShop, getFirstMembership, isOpenSignup } from '@shopnex/tenancy'

export type SignupResult = { error?: string }

// Named like the single-store shop until the owner names it in /admin/welcome
const NEW_SHOP_NAME = 'My Shop'

// The one place a self-serve shop is made, for every sign-up path (email, OAuth, or an account that stopped halfway):
// the account exists first (sign-up is rate limited by Better Auth), then this makes its shop. One shop each.
export const createMyShop = createServerFn({ method: 'POST' }).handler(async (): Promise<SignupResult> => {
  if (!isOpenSignup) return { error: 'Creating shops is disabled' }
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return { error: 'Sign in first' }
  if (await getFirstMembership(session.user.id)) return { error: 'You already have a shop' }
  const shop = await createShop({ ownerId: session.user.id, name: NEW_SHOP_NAME })
  // Sample products are a nicety: the shop is usable without them
  await seedSampleProducts(shop.id).catch(() => {})
  return {}
})
