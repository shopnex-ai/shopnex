import { createServerFn } from '@tanstack/react-start'
import { appService, marketplaceService } from '@shopnex/apps'
import { getAdminContext } from '@/lib/session.functions'
import { embeddedAppAccess } from './access'

export const getMarketplaceInstanceUrl = createServerFn({ method: 'GET' }).handler(() =>
  marketplaceService.instanceUrl(),
)

export const getEmbeddedApp = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => ({ id: input.id }))
  .handler(async ({ data }) => {
    // This is a public RPC endpoint of its own: authorize here, from the request's session, not in the page loader.
    const access = embeddedAppAccess(await getAdminContext())
    if (access.status === 'none') return null
    if (access.status === 'forbidden') return { forbidden: true as const }
    const { shopId, userId } = access
    const installation = await appService.getInstallationWithApp(shopId, data.id)
    if (!installation) return null
    const instanceUrl = await marketplaceService.instanceUrl()
    const token = await appService.createSessionToken({
      shopId,
      installationId: installation.id,
      userId,
    })
    const src = new URL(installation.app.appUrl)
    src.searchParams.set('shop_id', shopId)
    src.searchParams.set('instance', instanceUrl)
    src.searchParams.set('session_token', token)
    src.searchParams.set('embedded', '1')
    return { installation, src: src.toString() }
  })
