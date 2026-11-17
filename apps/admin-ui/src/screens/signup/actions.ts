import { publicFn } from '@/lib/server-fn'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '@shopnex/auth'
import { createShop, getFirstMembership, isOpenSignup, NEW_SHOP_NAME } from '@shopnex/tenancy'

export type SignupResult = { error?: string }

// New accounts get their shop when they are created (createShopForNewAccount in @shopnex/auth). This is only for an
// account made before that, which has none: the "Create your shop" card. One shop each.
export const createMyShop = publicFn({ method: 'POST' }).handler(async (): Promise<SignupResult> => {
  if (!isOpenSignup) return { error: 'Creating shops is disabled' }
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return { error: 'Sign in first' }
  if (await getFirstMembership(session.user.id)) return { error: 'You already have a shop' }
  // A new shop gets its menus from content's shopCreated listener, which only exists once the module is loaded. Loaded here,
  // inside the handler, and not with a bare `import '@shopnex/content'` at the top: this file is imported by client code, the
  // framework strips the handler (and what only it uses) from the browser bundle, but it would keep a bare import, and with it
  // server code that crashes the page.
  await import('@shopnex/content')
  await createShop({ ownerId: session.user.id, name: NEW_SHOP_NAME })
  return {}
})
