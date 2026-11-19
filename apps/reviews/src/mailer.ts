// How a review request reaches the buyer: through the shop's own email settings (Settings → Email), with one call
// to the Admin API. The merchant sets up sending once for the whole shop; this app keeps no email server of its own.
import type { ShopContext } from '@shopnex/app'

export type ReviewEmail = { to: string; productTitle: string; shopName: string | null; link: string }
export type Mailer = (email: ReviewEmail) => Promise<void> | void

/** The shop has email off (Settings → Email): nothing was sent, and it will work once the merchant turns it on */
export class EmailOffError extends Error {
  constructor() {
    super('Email is off for this shop')
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export function renderEmail({ productTitle, shopName, link }: Omit<ReviewEmail, 'to'>) {
  const from = shopName ? ` from ${shopName}` : ''
  const subject = `How was your ${productTitle}?`
  const text = `Thanks for your order${from}.\n\nWould you leave a quick review of ${productTitle}? It helps other shoppers.\n\n${link}\n`
  const html =
    `<p>Thanks for your order${escapeHtml(from)}.</p>` +
    `<p>Would you leave a quick review of <strong>${escapeHtml(productTitle)}</strong>? It helps other shoppers.</p>` +
    `<p><a href="${escapeHtml(link)}">Write a review</a></p>`
  return { subject, text, html }
}

const OFF_KEY = 'email_off'

/** Whether the last send found email off, so the app can tell the merchant where to turn it on */
export const readEmailOff = async (shop: ShopContext) => (await shop.data.get<boolean>(OFF_KEY)) === true

/** The shop's mailer: sends through Settings → Email. Throws EmailOffError while the shop has it off. */
export function emailMailer(shop: ShopContext): Mailer {
  return async (email) => {
    const { sent } = await shop.admin.api.post('/email/send', {
      body: { to: email.to, ...renderEmail(email) },
    })
    // Only write when it changes: this runs for every request
    const off = await readEmailOff(shop)
    if (!sent) {
      if (!off) await shop.data.set(OFF_KEY, true)
      throw new EmailOffError()
    }
    if (off) await shop.data.set(OFF_KEY, false)
  }
}
