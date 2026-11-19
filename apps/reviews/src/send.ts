// Sends the review requests that are due, each through its own shop's mailer. A request that can't go out (the shop
// has email off, its server is down, the app was uninstalled) stays due, so a later pass tries again.
import { log } from './log'
import { EmailOffError, type Mailer } from './mailer'
import type { Store } from './store'

export const reviewLink = (appUrl: string, token: string) => `${appUrl}/r/${token}`

type ShopRef = { instance: string; shopId: string }
/** The mailer for a shop, with the shop's name for the email; null when the shop can't be reached */
export type MailerFor = (shop: ShopRef) => Promise<{ mailer: Mailer; shopName: string | null } | null>

export async function sendDue(store: Store, options: { appUrl: string; mailerFor: MailerFor; now?: number }) {
  const now = options.now ?? Date.now()
  const mailers = new Map<string, Awaited<ReturnType<MailerFor>>>()
  // Shops that have email off: one answer is enough for this pass, the rest of their requests wait
  const off = new Set<string>()
  let sent = 0
  for (const request of await store.due(now)) {
    const key = `${request.instance}|${request.shopId}`
    if (off.has(key)) continue
    if (!mailers.has(key)) {
      mailers.set(
        key,
        await options.mailerFor(request).catch((error) => {
          log.error({ err: error, instance: request.instance }, 'cannot reach the shop to send review requests')
          return null
        }),
      )
    }
    const target = mailers.get(key)
    if (!target) continue
    try {
      await target.mailer({
        to: request.email,
        productTitle: request.productTitle,
        shopName: target.shopName,
        link: reviewLink(options.appUrl, request.token),
      })
      await store.markSent(request.token, now)
      sent++
    } catch (error) {
      if (error instanceof EmailOffError) off.add(key)
      else log.error({ err: error, shopId: request.shopId }, 'could not send a review request')
    }
  }
  return sent
}
