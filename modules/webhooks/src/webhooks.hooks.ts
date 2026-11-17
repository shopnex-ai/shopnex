// What webhooks does when another module says something happened. Loaded by the module and the package entry, so any process that can
// revoke an API token has it (api/tests/uninstall-hooks.test.ts revokes through the real route).
import { eq } from 'drizzle-orm'
import { apiTokenRevoked } from '@shopnex/tenancy'
import { webhookEndpoints } from './webhooks.schema'

// An app's (or script's) subscriptions go with its token; their pending deliveries go with them
apiTokenRevoked.on('webhooks.endpoints', async (conn, { tokenId }) => {
  await conn.delete(webhookEndpoints).where(eq(webhookEndpoints.apiTokenId, tokenId))
})
