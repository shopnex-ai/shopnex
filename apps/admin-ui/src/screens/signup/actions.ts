import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createShopInput, signupInput } from '@shopnex/api/schemas'
import { auth } from '@shopnex/auth'
import { signUpWithShop } from '@shopnex/auth/signup'
import { seedSampleProducts } from '@shopnex/catalog'
import { createShop, getFirstMembership, isOpenSignup } from '@shopnex/tenancy'

export type SignupResult = { error?: string }

// Sample products are a nicety: the shop is usable without them
const seed = (shopId: string) => seedSampleProducts(shopId).catch(() => {})

export const runSignup = createServerFn({ method: 'POST' })
  .validator((values: unknown) => values)
  .handler(async ({ data }): Promise<SignupResult> => {
    const parsed = signupInput.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid details' }
    try {
      const { shop } = await signUpWithShop(parsed.data)
      await seed(shop.id)
      return {}
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Sign-up failed' }
    }
  })

// For accounts without a shop (OAuth sign-up, or a signup that stopped halfway). One shop each.
export const createMyShop = createServerFn({ method: 'POST' })
  .validator((values: unknown) => values)
  .handler(async ({ data }): Promise<SignupResult> => {
    if (!isOpenSignup) return { error: 'Creating shops is disabled' }
    const parsed = createShopInput.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid details' }
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session) return { error: 'Sign in first' }
    if (await getFirstMembership(session.user.id)) return { error: 'You already have a shop' }
    const shop = await createShop({ ownerId: session.user.id, name: parsed.data.shopName })
    await seed(shop.id)
    return {}
  })
