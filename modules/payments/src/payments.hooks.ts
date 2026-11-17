// What payments does when another module says something happened. Loaded by the module and the package entry, so any process
// that can uninstall an app through the API has it (api/tests/uninstall-hooks.test.ts uninstalls through the real route).
import { and, eq } from 'drizzle-orm'
import { appUninstalled } from '@shopnex/apps'
import { paymentMethods } from './payments.schema'

// A payments app's method leaves checkout with it (orders keep their gateway snapshot)
appUninstalled.on('payments.method', async (conn, { shopId, appId }) => {
  await conn.delete(paymentMethods).where(and(eq(paymentMethods.shopId, shopId), eq(paymentMethods.appId, appId)))
})
