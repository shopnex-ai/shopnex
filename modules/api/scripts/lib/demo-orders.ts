// Backdated sample orders so the dashboard analytics have something to show: ~90 days of sales on a rising
// trend with a weekend bump, returning customers, a few unpaid, cancelled and discounted orders.
// Rows are inserted directly (no stock changes, webhooks or emails). Customers use @demo.shopnex.test addresses,
// which is also how a previous run is recognised (a domain nothing else uses, since --replace deletes by it) and replaced.
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { channelService } from '@shopnex/channels'
import { db, schema } from '@shopnex/db'

const DEMO_DOMAIN = '@demo.shopnex.test'
const DISCOUNT_CODE = 'WELCOME10'
const SHIPPING = { title: 'Standard shipping', code: 'standard', priceCents: 500, freeAboveCents: 7500 }

const firstNames = ['Ava', 'Liam', 'Noah', 'Mia', 'Ethan', 'Zoe', 'Lucas', 'Chloe', 'Mason', 'Ella', 'Leo', 'Nora']
const lastNames = ['Carter', 'Nguyen', 'Silva', 'Keller', 'Ortiz', 'Ivanov', 'Rossi', 'Haas', 'Moreau', 'Kim']
const places = [
  { city: 'Austin', province: 'TX', countryCode: 'US', zip: '78701' },
  { city: 'Portland', province: 'OR', countryCode: 'US', zip: '97201' },
  { city: 'Brooklyn', province: 'NY', countryCode: 'US', zip: '11201' },
  { city: 'Toronto', province: 'ON', countryCode: 'CA', zip: 'M5V 2T6' },
  { city: 'Berlin', province: null, countryCode: 'DE', zip: '10115' },
  { city: 'London', province: null, countryCode: 'GB', zip: 'E1 6AN' },
]

// Deterministic, so the same seed gives the same shop every time
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Wall-clock `minutes` ago in the database session's timezone, which is how created_at defaults are filled
const minutesAgo = (minutes: number) => sql`localtimestamp - make_interval(mins => ${Math.max(0, Math.round(minutes))})`

export async function deleteDemoOrders(shopId: string) {
  const demo = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), like(schema.customers.email, `%${DEMO_DOMAIN}`)))
  if (!demo.length) return 0
  const ids = demo.map((c) => c.id)
  // Order rows (items, transactions, fulfillments) cascade
  await db.delete(schema.orders).where(inArray(schema.orders.customerId, ids))
  await db.delete(schema.customers).where(inArray(schema.customers.id, ids))
  return ids.length
}

export async function seedDemoOrders(shopId: string, { days = 90 }: { days?: number } = {}) {
  const [existing] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), like(schema.customers.email, `%${DEMO_DOMAIN}`)))
    .limit(1)
  if (existing) throw new Error('Demo orders already exist for this shop (use --replace to regenerate them).')

  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, shopId))
  if (!shop) throw new Error(`Shop "${shopId}" not found.`)
  const channel = await channelService.getDefault(shopId)

  const variants = await db
    .select({
      productId: schema.products.id,
      productTitle: schema.products.title,
      vendor: schema.products.vendor,
      tags: schema.products.tags,
      variantId: schema.productVariants.id,
      variantTitle: schema.productVariants.title,
      optionsKey: schema.productVariants.optionsKey,
      sku: schema.productVariants.sku,
      priceCents: schema.productVariants.priceCents,
      imageUrl: sql<
        string | null
      >`(select pi.url from product_images pi where pi.product_id = ${schema.products.id} order by pi.position limit 1)`,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.status, 'active')))
    .orderBy(schema.products.title, schema.productVariants.optionsKey)
  if (!variants.length) throw new Error('The shop has no active products to order. Seed the catalog first.')

  // Use the demo catalog when it is there, so a shop's own products don't skew the numbers
  const demo = variants.filter((v) => v.tags.includes('demo'))
  const byProduct = new Map<string, typeof variants>()
  for (const v of demo.length ? demo : variants) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v])
  const products = [...byProduct.values()]
  // Products tagged "bestseller" sell about four times as often as the rest
  const weights = products.map((p) => (p[0]!.tags.includes('bestseller') ? 4 : 1))
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  const rand = rng(1001)
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!
  const weightedProduct = () => {
    let r = rand() * totalWeight
    return products.find((_, i) => (r -= weights[i]!) < 0) ?? products[0]!
  }

  // Most orders come from a new customer; the rest from an earlier one, with early customers more likely
  // to come back (the regulars)
  const people: { name: string; first: string; last: string; email: string; place: (typeof places)[number] }[] = []
  const nextPerson = () => {
    if (people.length && rand() > 0.68) return Math.floor(Math.pow(rand(), 1.6) * people.length)
    const i = people.length
    const first = firstNames[i % firstNames.length]!
    const last = lastNames[(i * 7) % lastNames.length]!
    people.push({
      name: `${first} ${last}`,
      first,
      last,
      email: `${first}.${last}${i}${DEMO_DOMAIN}`.toLowerCase(),
      place: pick(places),
    })
    return i
  }

  // Plan the orders, oldest first
  const now = new Date()
  const nowMinuteOfDay = now.getHours() * 60 + now.getMinutes()
  const planned: {
    ago: number
    person: number
    lines: { v: (typeof variants)[number]; quantity: number }[]
    discounted: boolean
    outcome: 'fulfilled' | 'paid' | 'pending' | 'cancelled'
  }[] = []
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(now.getTime() - d * 86_400_000)
    const weekend = date.getDay() === 0 || date.getDay() === 6
    const growth = 1 + ((days - d) / days) * 1.2
    const count = Math.max(0, Math.round((2.2 + rand() * 2.2) * growth * (weekend ? 1.3 : 1) - 1))
    for (let n = 0; n < count; n++) {
      // Mostly daytime and evening
      const minuteOfDay = Math.floor((9 + rand() * rand() * 14 + rand() * 4) * 60) % 1440
      const ago = d * 1440 + (nowMinuteOfDay - minuteOfDay)
      if (ago < 0) continue
      const lineCount = rand() < 0.65 ? 1 : rand() < 0.75 ? 2 : 3
      const chosen = new Set<string>()
      const lines = []
      for (let l = 0; l < lineCount; l++) {
        const options = weightedProduct()
        if (chosen.has(options[0]!.productId)) continue
        chosen.add(options[0]!.productId)
        lines.push({ v: pick(options), quantity: rand() < 0.8 ? 1 : 2 })
      }
      const r = rand()
      const age = ago / 1440
      const outcome =
        r < 0.04 ? 'cancelled' : age < 2 && r < 0.4 ? 'pending' : age < 3 ? 'paid' : r < 0.12 ? 'paid' : 'fulfilled'
      planned.push({ ago, person: nextPerson(), lines, discounted: rand() < 0.12, outcome })
    }
  }
  planned.sort((a, b) => b.ago - a.ago)

  await db.transaction(async (tx) => {
    // Customers, created when they first ordered
    const firstOrder = new Map<number, number>()
    for (const o of planned) if (!firstOrder.has(o.person)) firstOrder.set(o.person, o.ago)
    const customerIds = new Map<number, string>()
    for (const [index, ago] of firstOrder) {
      const p = people[index]!
      const [row] = await tx
        .insert(schema.customers)
        .values({
          shopId,
          email: p.email,
          name: p.name,
          createdAt: minutesAgo(ago),
          updatedAt: minutesAgo(ago),
        })
        .returning({ id: schema.customers.id })
      customerIds.set(index, row!.id)
    }

    let orderNumber = shop.nextOrderNumber
    for (const o of planned) {
      const person = people[o.person]!
      const subtotalCents = o.lines.reduce((s, l) => s + l.v.priceCents * l.quantity, 0)
      const shippingCents = subtotalCents >= SHIPPING.freeAboveCents ? 0 : SHIPPING.priceCents
      const discountCents = o.discounted ? Math.round(subtotalCents * 0.1) : 0
      const totalCents = subtotalCents + shippingCents - discountCents
      const cancelled = o.outcome === 'cancelled'
      const paid = o.outcome === 'paid' || o.outcome === 'fulfilled'
      const address = {
        firstName: person.first,
        lastName: person.last,
        company: null,
        address1: `${10 + Math.floor(rand() * 90)} Market Street`,
        address2: null,
        phone: null,
        ...person.place,
      }

      const [order] = await tx
        .insert(schema.orders)
        .values({
          shopId,
          channelId: channel.id,
          orderNumber: orderNumber++,
          customerId: customerIds.get(o.person)!,
          email: person.email,
          financialStatus: cancelled ? 'voided' : paid ? 'paid' : 'pending',
          fulfillmentStatus: o.outcome === 'fulfilled' ? 'fulfilled' : 'unfulfilled',
          cancelledAt: cancelled ? minutesAgo(o.ago - 60) : null,
          cancelReason: cancelled ? 'customer' : null,
          currency: shop.currency,
          subtotalCents,
          shippingCents,
          discountCents,
          totalCents,
          discountCodes: o.discounted ? [DISCOUNT_CODE] : [],
          shippingAddress: address,
          billingAddress: address,
          paymentGateway: 'manual',
          paymentMethodName: 'Bank transfer',
          createdAt: minutesAgo(o.ago),
          updatedAt: minutesAgo(o.ago),
        })
        .returning({ id: schema.orders.id })
      const orderId = order!.id

      // Spread the order discount over the lines; the last line takes the rounding remainder
      let left = discountCents
      await tx.insert(schema.orderItems).values(
        o.lines.map((l, i) => {
          const share =
            i === o.lines.length - 1 ? left : Math.round((discountCents * l.v.priceCents * l.quantity) / subtotalCents)
          left -= share
          return {
            orderId,
            productId: l.v.productId,
            variantId: l.v.variantId,
            title: l.v.productTitle,
            variantTitle: l.v.optionsKey === '' ? null : l.v.variantTitle,
            sku: l.v.sku,
            vendor: l.v.vendor || null,
            imageUrl: l.v.imageUrl,
            unitPriceCents: l.v.priceCents,
            quantity: l.quantity,
            discountCents: share,
          }
        }),
      )
      await tx
        .insert(schema.orderShippingLines)
        .values({ orderId, title: SHIPPING.title, code: SHIPPING.code, priceCents: shippingCents })
      if (paid) {
        await tx.insert(schema.orderTransactions).values({
          orderId,
          kind: 'sale',
          status: 'success',
          gateway: 'manual',
          amountCents: totalCents,
          currency: shop.currency,
          processedAt: minutesAgo(o.ago - 120),
        })
      }
      if (o.outcome === 'fulfilled') {
        await tx.insert(schema.fulfillments).values({
          orderId,
          trackingCompany: 'DHL',
          trackingNumber: `DEMO${String(orderNumber).padStart(8, '0')}`,
          createdAt: minutesAgo(o.ago - 1440),
        })
      }
    }

    await tx.update(schema.shops).set({ nextOrderNumber: orderNumber }).where(eq(schema.shops.id, shopId))
  })

  return { orders: planned.length, customers: new Set(planned.map((o) => o.person)).size }
}
