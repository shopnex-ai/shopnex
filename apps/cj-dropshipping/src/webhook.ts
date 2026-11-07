// Paid orders reach the app through a subscription made with its own token. Uninstalling the app deletes it (and
// installing again makes a new token), so check it is there instead of remembering that it was made.
//
// Two things can ask for it at once (the settings page opened twice, or opened while the CJ key is being saved).
// Both would see no subscription and each make one, so concurrent calls for a shop share one run, and duplicates
// that are already there are deleted.
import type { ShopContext } from '@shopnex/app'

const running = new Map<string, Promise<void>>()

export function ensureOrderWebhook(shop: ShopContext, appUrl: string) {
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
  const [keep, ...duplicates] = mine.filter((h) => h.url === url && h.active && h.topics.includes('order.paid'))
  for (const duplicate of duplicates) {
    await shop.admin.api.delete('/webhooks/{id}', { params: { path: { id: duplicate.id } } })
  }
  if (keep) return
  await shop.admin.api.post('/webhooks', {
    body: { url, description: 'CJ Dropshipping', topics: ['order.paid'], active: true },
  })
}
