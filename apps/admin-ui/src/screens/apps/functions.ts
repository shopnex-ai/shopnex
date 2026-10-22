import { createServerFn } from '@tanstack/react-start'
import { appService, marketplaceService } from '@shopnex/apps'

export const getMarketplaceInstanceUrl = createServerFn({ method: 'GET' }).handler(() =>
  marketplaceService.instanceUrl(),
)

export const getEmbeddedApp = createServerFn({ method: 'GET' })
  .validator((input: { id: string; shopId: string; userId: string }) => input)
  .handler(async ({ data }) => {
    const installation = await appService.getInstallationWithApp(data.shopId, data.id)
    if (!installation) return null
    const instanceUrl = await marketplaceService.instanceUrl()
    const token = await appService.createSessionToken({
      shopId: data.shopId,
      installationId: installation.id,
      userId: data.userId,
    })
    const src = new URL(installation.app.appUrl)
    src.searchParams.set('shop_id', data.shopId)
    src.searchParams.set('instance', instanceUrl)
    src.searchParams.set('session_token', token)
    src.searchParams.set('embedded', '1')
    return { installation, src: src.toString() }
  })
