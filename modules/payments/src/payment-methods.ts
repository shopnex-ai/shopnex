// Settings → Payments: the methods a shop offers at checkout. Manual ones (bank transfer, cash on delivery…) are made by
// staff here; a payments app's method is registered by the app (methods.ts). Every query is scoped by shopId.
import { and, asc, eq } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { only } from './rows'
import { paymentMethods, type PaymentMethod } from './payments.schema'

export type PaymentMethodInput = Pick<
  typeof paymentMethods.$inferInsert,
  'name' | 'additionalDetails' | 'instructions' | 'active'
>

export async function list(shopId: string, opts: { activeOnly?: boolean }, conn: Conn): Promise<PaymentMethod[]> {
  return conn
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.shopId, shopId),
        opts.activeOnly ? eq(paymentMethods.active, true) : undefined,
        opts.activeOnly ? eq(paymentMethods.ready, true) : undefined,
      ),
    )
    .orderBy(asc(paymentMethods.position), asc(paymentMethods.createdAt))
}

export async function create(shopId: string, input: PaymentMethodInput, conn: Conn) {
  return only(
    await conn
      .insert(paymentMethods)
      .values({ ...input, shopId, provider: 'manual' })
      .returning(),
  )
}

export async function update(shopId: string, id: string, patch: Partial<PaymentMethodInput>, conn: Conn) {
  const [method] = await conn
    .update(paymentMethods)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(paymentMethods.shopId, shopId), eq(paymentMethods.id, id)))
    .returning()
  return method ?? null
}

// Orders keep the method's name and instructions (snapshot). A payments app's method goes when the app is
// uninstalled, not from here (it would just configure it again).
export async function remove(shopId: string, id: string, conn: Conn) {
  const [method] = await conn
    .delete(paymentMethods)
    .where(and(eq(paymentMethods.shopId, shopId), eq(paymentMethods.id, id), eq(paymentMethods.provider, 'manual')))
    .returning()
  return method ?? null
}
