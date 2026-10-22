import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

type StartupGlobal = typeof globalThis & { shopnexBackgroundServices?: Promise<void> }
const startupGlobal = globalThis as StartupGlobal

function startBackgroundServices() {
  startupGlobal.shopnexBackgroundServices ??= (async () => {
    const [
      { startDeliveryWorker },
      { startPaymentsWorker },
      { startEmailWorker },
      { isMultiTenant },
      { appService, instanceSignature, marketplaceService },
    ] = await Promise.all([
      import('@shopnex/webhooks/worker'),
      import('@shopnex/payments/worker'),
      import('@shopnex/email'),
      import('@shopnex/tenancy'),
      import('@shopnex/apps'),
    ])
    startDeliveryWorker({ allowPrivateNetworks: !isMultiTenant, instanceSignature })
    startPaymentsWorker()
    startEmailWorker()
    marketplaceService.startMarketplaceSync()
    await appService.registerBundledApps().catch((error) => console.error('[apps] bundled apps:', error))
  })().catch((error) => {
    startupGlobal.shopnexBackgroundServices = undefined
    throw error
  })
  return startupGlobal.shopnexBackgroundServices
}

export default createServerEntry({
  async fetch(request, options) {
    await startBackgroundServices()
    return handler.fetch(request, options)
  },
})
