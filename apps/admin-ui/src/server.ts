import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

type StartupGlobal = typeof globalThis & {
  shopnexBackgroundServices?: Promise<void>
  shopnexRejectionLogger?: true
}
const startupGlobal = globalThis as StartupGlobal

// A rejected promise nobody awaited (in a worker, a call to an app or an AI provider…) would make Node exit, taking
// checkout down with it: log it instead. Registered once, also across dev reloads.
if (!startupGlobal.shopnexRejectionLogger) {
  startupGlobal.shopnexRejectionLogger = true
  process.on('unhandledRejection', (reason) => console.error('[shopnex] unhandled rejection:', reason))
}

function startBackgroundServices() {
  startupGlobal.shopnexBackgroundServices ??= (async () => {
    // The embedded database (DATABASE_URL=pglite:…) is migrated here, before anything queries it
    await (await import('@shopnex/db')).prepareDatabase()
    const [
      { startDeliveryWorker },
      { startPaymentsWorker },
      { startEmailWorker },
      { isMultiTenant },
      { appService, instanceSignature, marketplaceService, serverUrl },
    ] = await Promise.all([
      import('@shopnex/webhooks/worker'),
      import('@shopnex/payments/worker'),
      import('@shopnex/email'),
      import('@shopnex/tenancy'),
      import('@shopnex/apps'),
    ])
    startDeliveryWorker({ allowPrivateNetworks: !isMultiTenant, instanceSignature, resolveUrl: serverUrl })
    startPaymentsWorker()
    startEmailWorker()
    marketplaceService.startMarketplaceSync()
    appService.registerBundledApps()
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
