import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { isSetupComplete } from '@shopnex/auth/setup'
import { auth, enabledSocialProviders, isSuperAdmin } from '@shopnex/auth'
import { resolveAdminShop } from '@shopnex/tenancy'

export const getSocialProviders = createServerFn({ method: 'GET' }).handler(() => enabledSocialProviders)

export const getAdminContext = createServerFn({ method: 'GET' }).handler(async () => {
  const setupComplete = await isSetupComplete()
  if (!setupComplete) return { setupComplete, session: null, tenant: null }
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return { setupComplete, session: null, tenant: null }
  const tenant = await resolveAdminShop({
    userId: session.user.id,
    activeShopId: session.session.activeOrganizationId,
    superAdmin: isSuperAdmin(session.user),
  })
  return { setupComplete, session, tenant }
})

export const getSetupStatus = createServerFn({ method: 'GET' }).handler(async () => isSetupComplete())
