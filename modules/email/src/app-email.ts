// Email from an installed app (review requests…) through the shop's own email settings, so merchants set up
// sending once (Settings → Email) and apps need no server of their own. It is a narrow door, because it sends
// from the shop's address on a third party's say:
//   - only to people who are customers of this shop (an app can't use the shop as a mail relay)
//   - one recipient per call, bounded size (the contract), and a limit per app and shop per hour
// With email off nothing is sent and the answer says so (`sent: false`), so the app can try again later.
import { and, eq, sql } from 'drizzle-orm'
import { type Conn } from '@shopnex/db'
import { customers } from '@shopnex/customers/schema'
import { send } from './email'
import { EmailError } from './email.errors'

export const APP_EMAILS_PER_HOUR = 500
const HOUR_MS = 3_600_000

const windows = new Map<string, { count: number; resetAt: number }>()

/** Counts one send for this app in this shop; throws SEND_LIMIT past the limit. Per process. */
function take(shopId: string, appId: string, now: number, limit: number) {
  const key = `${shopId}|${appId}`
  let w = windows.get(key)
  if (!w || w.resetAt <= now) {
    for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k)
    w = { count: 0, resetAt: now + HOUR_MS }
    windows.set(key, w)
  }
  if (w.count >= limit) {
    throw new EmailError('SEND_LIMIT', 'This app sent too many emails this hour, try again later')
  }
  w.count++
}

export const resetAppEmailLimits = () => windows.clear()

export async function sendForApp(
  shopId: string,
  appId: string,
  message: { to: string; subject: string; text?: string; html?: string },
  conn: Conn,
  options: { now?: number; limit?: number } = {},
) {
  const [customer] = await conn
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.shopId, shopId), sql`lower(${customers.email}) = ${message.to.toLowerCase()}`))
    .limit(1)
  if (!customer) throw new EmailError('RECIPIENT_UNKNOWN', 'That address is not a customer of this shop')
  take(shopId, appId, options.now ?? Date.now(), options.limit ?? APP_EMAILS_PER_HOUR)
  return send(shopId, message, conn)
}
