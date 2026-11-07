import { appService, marketplaceService } from '@shopnex/apps'
import { adminFn, publicFn } from '@/lib/server-fn'

// Public: the instance's own URL, which every embedded app is also told
export const getMarketplaceInstanceUrl = publicFn({ method: 'GET' }).handler(() => marketplaceService.instanceUrl())

export const getEmbeddedApp = adminFn
  .validator((input: { id: string }) => ({ id: input.id }))
  .handler(async ({ data, context: { shopId, userId } }) => {
    const installation = await appService.getInstallationWithApp(shopId, data.id)
    if (!installation) return null
    const instanceUrl = await marketplaceService.instanceUrl()
    const token = await appService.createSessionToken({ shopId, installationId: installation.id, userId })
    const src = new URL(installation.app.appUrl)
    src.searchParams.set('shop_id', shopId)
    src.searchParams.set('instance', instanceUrl)
    src.searchParams.set('session_token', token)
    src.searchParams.set('embedded', '1')
    return { installation, src: src.toString() }
  })
