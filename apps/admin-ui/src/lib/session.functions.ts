import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { isSetupComplete } from '@shopnex/auth/setup'
import { auth, enabledSocialProviders, isSuperAdmin } from '@shopnex/auth'
import { isOpenSignup, listSwitchableShops, resolveAdminShop, setActiveShop } from '@shopnex/tenancy'

export const getSocialProviders = createServerFn({ method: 'GET' }).handler(() => enabledSocialProviders)

// Public demo only (DEMO_MODE=true): the shared login that /admin/login?demo prefills. These credentials are
// meant to be public, which is why nothing else ever returns them.
export const getDemoLogin = createServerFn({ method: 'GET' }).handler(() => {
  const { DEMO_MODE, DEMO_EMAIL, DEMO_PASSWORD } = process.env
  return DEMO_MODE === 'true' && DEMO_EMAIL && DEMO_PASSWORD ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null
})

export const getAdminContext = createServerFn({ method: 'GET' }).handler(async () => {
  const setupComplete = await isSetupComplete()
  const openSignup = isOpenSignup
  if (!setupComplete) return { setupComplete, openSignup, session: null, tenant: null }
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return { setupComplete, openSignup, session: null, tenant: null }
  const tenant = await resolveAdminShop({
    userId: session.user.id,
    activeShopId: session.session.activeOrganizationId,
    superAdmin: isSuperAdmin(session.user),
  })
  return { setupComplete, openSignup, session, tenant }
})

export const getSetupStatus = createServerFn({ method: 'GET' }).handler(async () => isSetupComplete())

// Shops the sidebar's switcher offers (empty in single mode, or without a session)
export const getSwitchableShops = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  return session ? listSwitchableShops(session.user.id, isSuperAdmin(session.user)) : []
})

export const switchShop = createServerFn({ method: 'POST' })
  .validator((shopId: string) => shopId)
  .handler(async ({ data: shopId }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session) return { ok: false }
    const ok = await setActiveShop({
      sessionId: session.session.id,
      userId: session.user.id,
      superAdmin: isSuperAdmin(session.user),
      shopId,
    })
    return { ok }
  })
