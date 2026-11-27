// How a review request reaches the buyer: through the shop's own email settings (Settings → Email), with one call
// to the Admin API. The merchant sets up sending once for the whole shop; this app keeps no email server of its own.
import type { ShopContext } from '@shopnex/app'

/** The shop's own wording (Reviews → Settings); empty means the standard text. `{product}` and `{shop}` are filled in. */
export type EmailTexts = { subject?: string | null; message?: string | null }

export type ReviewEmail = { to: string; productTitle: string; shopName: string | null; link: string } & EmailTexts
export type Mailer = (email: ReviewEmail) => Promise<void> | void

/** The shop has email off (Settings → Email): nothing was sent, and it will work once the merchant turns it on */
export class EmailOffError extends Error {
  constructor() {
    super('Email is off for this shop')
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export const MAX_SUBJECT = 150
export const MAX_MESSAGE = 2000
const TEXT_KEYS = { subject: 'email_subject', message: 'email_message' } as const

export function renderEmail({
  productTitle,
  shopName,
  link,
  subject: ownSubject,
  message: ownMessage,
}: Omit<ReviewEmail, 'to'>) {
  const fill = (text: string) => text.replaceAll('{product}', productTitle).replaceAll('{shop}', shopName ?? 'our shop')
  const subject = ownSubject?.trim() ? fill(ownSubject.trim()) : `How was your ${productTitle}?`
  const own = ownMessage?.trim() ? fill(ownMessage.trim()).split(/\n\s*\n/) : null
  if (own) {
    return {
      subject,
      text: `${own.join('\n\n')}\n\n${link}\n`,
      html:
        own.map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('') +
        `<p><a href="${escapeHtml(link)}">Write a review</a></p>`,
    }
  }
  const from = shopName ? ` from ${shopName}` : ''
  const text = `Thanks for your order${from}.\n\nWould you leave a quick review of ${productTitle}? It helps other shoppers.\n\n${link}\n`
  const html =
    `<p>Thanks for your order${escapeHtml(from)}.</p>` +
    `<p>Would you leave a quick review of <strong>${escapeHtml(productTitle)}</strong>? It helps other shoppers.</p>` +
    `<p><a href="${escapeHtml(link)}">Write a review</a></p>`
  return { subject, text, html }
}

/** The shop's own subject and message, if it wrote any */
export async function readEmailTexts(shop: ShopContext): Promise<EmailTexts> {
  return {
    subject: await shop.data.get<string>(TEXT_KEYS.subject),
    message: await shop.data.get<string>(TEXT_KEYS.message),
  }
}

export async function saveEmailTexts(shop: ShopContext, texts: { subject: string; message: string }) {
  await shop.data.set(TEXT_KEYS.subject, texts.subject)
  await shop.data.set(TEXT_KEYS.message, texts.message)
}

const OFF_KEY = 'email_off'

/** Whether the last send found email off, so the app can tell the merchant where to turn it on */
export const readEmailOff = async (shop: ShopContext) => (await shop.data.get<boolean>(OFF_KEY)) === true

/** The shop's mailer: sends through Settings → Email. Throws EmailOffError while the shop has it off. */
export function emailMailer(shop: ShopContext): Mailer {
  // A mailer lives for one pass over the shop's due requests: its wording is read once, not for every email
  let texts: Promise<EmailTexts> | undefined
  return async (email) => {
    const own = await (texts ??= readEmailTexts(shop).catch(() => ({})))
    const { sent } = await shop.admin.api.post('/email/send', {
      body: { to: email.to, ...renderEmail({ ...own, ...email }) },
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
