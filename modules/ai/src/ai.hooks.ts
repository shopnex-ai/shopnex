// What ai does when another module says something happened. Loaded by the module and the package entry, so any process that can
// uninstall an app through the API has it (api/tests/uninstall-hooks.test.ts uninstalls through the real route).
import { and, eq } from 'drizzle-orm'
import { appUninstalled } from '@shopnex/apps'
import { aiProviders } from './ai.schema'

// An AI app's capabilities leave with it (its generations stay in the shop's history)
appUninstalled.on('ai.providers', async (conn, { shopId, appId }) => {
  await conn.delete(aiProviders).where(and(eq(aiProviders.shopId, shopId), eq(aiProviders.appId, appId)))
})
