// What the docs build reads to generate reference pages (apps/docs/scripts/generate-reference.ts), so those
// pages cannot drift from the code. Not used at runtime.
export { API_SCOPES, API_SCOPE_DESCRIPTIONS, SHOP_ROLES, SHOP_ROLE_DESCRIPTIONS } from '@shopnex/db/schema'
export { ENV_VARS } from './env-vars'
export {
  RETENTION_MS,
  RETRY_DELAYS_S,
  TIMEOUT_MS,
  WEBHOOK_TEST_TOPIC,
  WEBHOOK_TOPICS,
  WEBHOOK_TOPIC_DESCRIPTIONS,
} from '@shopnex/webhooks'
export { webhookPayloads } from './routers/admin/outputs'
