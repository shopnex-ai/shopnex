// Abandoned cart emails: the shop's settings (Settings → Notifications), and the unsubscribe link every
// reminder carries. They are off until the shop turns them on, the checkout says the email is used for cart
// reminders (as Shopify's does), and they stop for good once an address unsubscribes.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { shopnexSecret } from '@shopnex/db/secrets'
import { EmailError } from './errors'

export const DEFAULT_DELAY_MINUTES = 60
/** A reminder two minutes after leaving is a nuisance, one a month later is noise */
export const MIN_DELAY_MINUTES = 15
export const MAX_DELAY_MINUTES = 7 * 24 * 60

export type AbandonedCartSettingsView = { enabled: boolean; delayMinutes: number }

export async function getSettings(shopId: string, conn: Conn = db): Promise<AbandonedCartSettingsView> {
  const [row] = await conn
    .select()
    .from(schema.abandonedCartSettings)
    .where(eq(schema.abandonedCartSettings.shopId, shopId))
  return { enabled: row?.enabled ?? false, delayMinutes: row?.delayMinutes ?? DEFAULT_DELAY_MINUTES }
}

export async function updateSettings(shopId: string, patch: Partial<AbandonedCartSettingsView>) {
  if (
    patch.delayMinutes !== undefined &&
    (!Number.isInteger(patch.delayMinutes) ||
      patch.delayMinutes < MIN_DELAY_MINUTES ||
      patch.delayMinutes > MAX_DELAY_MINUTES)
  )
    throw new EmailError(
      'INVALID_TEMPLATE',
      `Wait between ${MIN_DELAY_MINUTES} minutes and ${MAX_DELAY_MINUTES / 60 / 24} days before the reminder`,
    )
  const values = { ...patch, updatedAt: new Date() }
  await db
    .insert(schema.abandonedCartSettings)
    .values({ shopId, ...values })
    .onConflictDoUpdate({ target: schema.abandonedCartSettings.shopId, set: values })
  return getSettings(shopId)
}

// --- unsubscribe ---

const sign = (payload: string) =>
  createHmac('sha256', shopnexSecret()).update(`shopnex:unsubscribe:v1:${payload}`).digest('base64url')

const normalize = (email: string) => email.trim().toLowerCase()

/** A link token that proves it came from us: shop and address, signed. It never expires (an unsubscribe shouldn't) */
export function unsubscribeToken(shopId: string, email: string) {
  const payload = Buffer.from(JSON.stringify([shopId, normalize(email)])).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function readToken(token: string): { shopId: string; email: string } | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const [shopId, email] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as [string, string]
    return typeof shopId === 'string' && typeof email === 'string' ? { shopId, email } : null
  } catch {
    return null
  }
}

/** Who a token unsubscribes (null for a forged or damaged one), for the confirmation page */
export const whoUnsubscribes = readToken

/** Records the unsubscribe. Returns false for a token that isn't ours. Safe to call again. */
export async function unsubscribe(token: string) {
  const who = readToken(token)
  if (!who) return false
  await db.insert(schema.emailSuppressions).values({ shopId: who.shopId, email: who.email }).onConflictDoNothing()
  return true
}

export async function isSuppressed(conn: Conn, shopId: string, email: string) {
  const [row] = await conn
    .select({ email: schema.emailSuppressions.email })
    .from(schema.emailSuppressions)
    .where(and(eq(schema.emailSuppressions.shopId, shopId), eq(schema.emailSuppressions.email, normalize(email))))
  return Boolean(row)
}

/** Whether the checkout should offer the reminder checkbox: the shop turned it on and can send email */
export async function offered(shopId: string) {
  const [settings, [email]] = await Promise.all([
    getSettings(shopId),
    db
      .select({ active: schema.emailSettings.active })
      .from(schema.emailSettings)
      .where(eq(schema.emailSettings.shopId, shopId)),
  ])
  return settings.enabled && Boolean(email?.active)
}
