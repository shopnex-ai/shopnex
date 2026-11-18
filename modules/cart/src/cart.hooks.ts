// What cart does when another module says something happened. Loaded by the module and the package entry, so any process that can
// uninstall an app through the API has it (api/tests/hooks.test.ts and uninstall-hooks.test.ts guard it).
import { and, eq } from 'drizzle-orm'
import { appUninstalled } from '@shopnex/apps'
import { carrierServices } from './cart.schema'

// A carrier app's service goes with it: its rates stop being offered at checkout
appUninstalled.on('cart.carrier-services', async (conn, { shopId, appId }) => {
  await conn.delete(carrierServices).where(and(eq(carrierServices.shopId, shopId), eq(carrierServices.appId, appId)))
})
