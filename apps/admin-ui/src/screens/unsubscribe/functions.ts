import { publicFn } from '@/lib/server-fn'
import { abandonedCartService } from '@shopnex/email'
import { getShopById } from '@shopnex/tenancy'

/** Who the link in a reminder email unsubscribes, or null when the link is damaged */
export const getUnsubscribe = publicFn({ method: 'GET' })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const who = abandonedCartService.whoUnsubscribes(token)
    if (!who) return null
    const shop = await getShopById(who.shopId)
    return shop ? { email: who.email, shopName: shop.name } : null
  })

// A button, not the link itself: mail scanners open links, and that must not unsubscribe anyone
export const confirmUnsubscribe = publicFn({ method: 'POST' })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => ({ ok: await abandonedCartService.unsubscribe(token) }))
