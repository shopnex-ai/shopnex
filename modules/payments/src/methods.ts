// Payments apps register their payment method for a shop (Shopify paymentsAppConfigure). Staff then see it in
// Settings → Payments, where they can rename, reorder or deactivate it; uninstalling the app removes it.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { PaymentError } from './errors'

export type ConfigureInput = {
  /** Shown at checkout on first configure, e.g. "Credit card" (staff can rename it) */
  name: string
  /** Snapshotted on orders as paymentGateway, e.g. "stripe" */
  gateway: string
  paymentSessionUrl: string
  refundSessionUrl: string
  /** false: not ready to take payments (e.g. no provider keys yet): hidden at checkout */
  ready: boolean
}

const origin = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Creates or updates the app's payment method in this shop. Session URLs must be on the app's own origin (its
 * registered app URL), so an app can't point Shopnex at someone else's server. Staff's name and position stay.
 */
export async function configure(shopId: string, appId: string, input: ConfigureInput) {
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId))
  if (!app) throw new PaymentError('NOT_A_PAYMENTS_APP', 'Only an installed app can configure a payment method')
  const appOrigin = origin(app.appUrl)
  for (const url of [input.paymentSessionUrl, input.refundSessionUrl]) {
    if (!appOrigin || origin(url) !== appOrigin) {
      throw new PaymentError('INVALID_SESSION_URL', `Session URLs must be on the app's origin (${appOrigin})`)
    }
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.shopId, shopId), eq(schema.paymentMethods.appId, appId)))
      .for('update')
    // `active` is staff's switch; `ready` is the app's
    const urls = {
      gateway: input.gateway,
      paymentSessionUrl: input.paymentSessionUrl,
      refundSessionUrl: input.refundSessionUrl,
      ready: input.ready,
    }
    if (existing) {
      const [method] = await tx
        .update(schema.paymentMethods)
        .set({ ...urls, updatedAt: new Date() })
        .where(eq(schema.paymentMethods.id, existing.id))
        .returning()
      return method!
    }
    // New card methods go first: most buyers pay by card
    const [first] = await tx
      .select({ position: sql<number>`coalesce(min(${schema.paymentMethods.position}), 0)::int` })
      .from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.shopId, shopId))
    const [method] = await tx
      .insert(schema.paymentMethods)
      .values({ ...urls, shopId, appId, provider: 'app', name: input.name, position: (first?.position ?? 0) - 1 })
      .returning()
    return method!
  })
}

/** Apps that can take payments (allowed write_payment_sessions) and aren't installed in this shop yet */
export async function availableApps(shopId: string) {
  const rows = await db
    .select({ app: schema.apps, installationId: schema.appInstallations.id })
    .from(schema.apps)
    .leftJoin(
      schema.appInstallations,
      and(
        eq(schema.appInstallations.appId, schema.apps.id),
        eq(schema.appInstallations.shopId, shopId),
        isNull(schema.appInstallations.uninstalledAt),
      ),
    )
    .where(and(sql`'write_payment_sessions' = any(${schema.apps.scopes})`, isNull(schema.apps.delistedAt)))
  return rows
    .filter((r) => r.installationId === null)
    .map(({ app }) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      iconUrl: app.iconUrl,
      appUrl: app.appUrl,
      clientId: app.clientId,
      redirectUrls: app.redirectUrls,
    }))
}
