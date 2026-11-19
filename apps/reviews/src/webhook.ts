// The order.fulfilled subscription this app makes with its own token (uninstalling deletes it, installing again
// makes a new token, so check it is there instead of remembering that it was made).
//
// Installing runs this twice at once: from app.installed and from the merchant's first page load. Both would see
// no subscription and each make one, so concurrent calls for a shop share one run, and any duplicates left by
// another process (or an older version of this app) are deleted.
import type { ShopContext } from '@shopnex/app'

const running = new Map<string, Promise<void>>()

export function ensureWebhook(shop: ShopContext, appUrl: string) {
  const key = `${shop.instance}|${shop.shopId}`
  const current = running.get(key)
  if (current) return current
  const run = setUp(shop, appUrl).finally(() => running.delete(key))
  running.set(key, run)
  return run
}

async function setUp(shop: ShopContext, appUrl: string) {
  const url = `${appUrl}/shopnex/webhook`
  const mine = await shop.admin.api.get('/webhooks')
  const [keep, ...duplicates] = mine.filter((h) => h.url === url && h.active && h.topics.includes('order.fulfilled'))
  for (const duplicate of duplicates) {
    await shop.admin.api.delete('/webhooks/{id}', { params: { path: { id: duplicate.id } } })
  }
  if (keep) return
  await shop.admin.api.post('/webhooks', {
    body: { url, description: 'Reviews', topics: ['order.fulfilled'], active: true },
  })
}
