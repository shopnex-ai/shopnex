// Home dashboard numbers, computed from orders (there is no visitor tracking yet, so no sessions or conversion).
// Like Shopify, a period is a run of whole days in the viewer's timezone, compared with the run just before it.
// Sales count every order that isn't cancelled, voided or fully refunded; partial refunds aren't subtracted.
import { sql } from 'drizzle-orm'
import { all, db, type Conn } from '@shopnex/db'

export type OverviewInput = {
  /** Days in the period, ending today (1 = today only) */
  days: number
  /** IANA timezone the days are cut in, e.g. "Europe/Berlin" */
  timezone: string
}

export type OverviewTotals = {
  salesCents: number
  orders: number
  averageOrderCents: number
  /** Customers with an order in the period who had ordered before it */
  returningCustomerRate: number
}

// created_at is a timestamp without time zone filled by now(), i.e. wall time in the database session's
// timezone; casting to timestamptz reads it back in that same timezone
const localDate = (timezone: string) => sql`(o.created_at::timestamptz at time zone ${timezone})::date`
const counted = sql`o.cancelled_at is null and o.financial_status not in ('voided', 'refunded')`

export async function overview(shopId: string, { days, timezone }: OverviewInput, conn: Conn = db) {
  const today = sql`(now() at time zone ${timezone})::date`
  const start = sql`(${today} - ${days - 1}::int)`
  const previousStart = sql`(${start} - ${days}::int)`
  // Coarse bound so the (shop_id, created_at) index is used; the exact cut is on the local date
  const recent = sql`o.created_at >= localtimestamp - make_interval(days => ${days * 2 + 2})`

  const [daily, customers, topProducts, attention] = await all(conn, [
    () =>
      conn.execute<{ day: string; sales: string; orders: number }>(sql`
      select to_char(${localDate(timezone)}, 'YYYY-MM-DD') as day,
             coalesce(sum(o.total_cents), 0)::bigint as sales,
             count(*)::int as orders
      from orders o
      where o.shop_id = ${shopId} and ${recent} and ${counted} and ${localDate(timezone)} >= ${previousStart}
      group by 1`),
    // Per period: customers who ordered, and how many of them had a counted order before the period began
    () =>
      conn.execute<{ current: boolean; customers: number; returning: number }>(sql`
      select p.current, count(*)::int as customers,
             count(*) filter (where exists (
               select 1 from orders prior
               where prior.shop_id = ${shopId} and prior.customer_id = p.customer_id
                 and prior.cancelled_at is null and prior.financial_status not in ('voided', 'refunded')
                 and (prior.created_at::timestamptz at time zone ${timezone})::date
                     < case when p.current then ${start} else ${previousStart} end
             ))::int as returning
      from (
        select distinct o.customer_id, ${localDate(timezone)} >= ${start} as current
        from orders o
        where o.shop_id = ${shopId} and ${recent} and ${counted} and o.customer_id is not null
          and ${localDate(timezone)} >= ${previousStart}
      ) p
      group by p.current`),
    () =>
      conn.execute<{
        product_id: string | null
        title: string
        image_url: string | null
        sales: string
        units: string
      }>(
        sql`
      -- The product's current title and primary image; the order-time snapshot only once it's deleted
      select t.product_id, coalesce(p.title, t.title) as title,
             coalesce((select pi.url from product_images pi where pi.product_id = t.product_id
                       order by pi.position limit 1), t.image_url) as image_url,
             t.sales, t.units
      from (
        select i.product_id, max(i.title) as title, max(i.image_url) as image_url,
               sum(i.unit_price_cents * i.quantity - i.discount_cents)::bigint as sales,
               sum(i.quantity)::bigint as units
        from order_items i join orders o on o.id = i.order_id
        where o.shop_id = ${shopId} and ${recent} and ${counted} and ${localDate(timezone)} >= ${start}
        group by i.product_id, case when i.product_id is null then i.title end
        order by sales desc
        limit 5
      ) t
      left join products p on p.id = t.product_id
      order by t.sales desc`,
      ),
    // Work waiting on staff, regardless of the period (same filters as the Unfulfilled and Unpaid order views)
    () =>
      conn.execute<{ unfulfilled: number; unpaid: number }>(sql`
      select count(*) filter (where o.fulfillment_status = 'unfulfilled')::int as unfulfilled,
             count(*) filter (where o.financial_status = 'pending')::int as unpaid
      from orders o
      where o.shop_id = ${shopId} and o.cancelled_at is null`),
  ])

  // One entry per day, zero-filled, with the matching day of the previous period alongside
  const byDay = new Map(daily.rows.map((r) => [r.day, r]))
  // en-CA formats as YYYY-MM-DD
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const dayKey = (offset: number) => {
    const d = new Date(`${todayKey}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - offset)
    return d.toISOString().slice(0, 10)
  }
  const series = Array.from({ length: days }, (_, i) => {
    const date = dayKey(days - 1 - i)
    const previousDate = dayKey(2 * days - 1 - i)
    const cur = byDay.get(date)
    const prev = byDay.get(previousDate)
    return {
      date,
      previousDate,
      salesCents: Number(cur?.sales ?? 0),
      orders: cur?.orders ?? 0,
      previousSalesCents: Number(prev?.sales ?? 0),
      previousOrders: prev?.orders ?? 0,
    }
  })

  const totals = (current: boolean): OverviewTotals => {
    const salesCents = series.reduce((s, d) => s + (current ? d.salesCents : d.previousSalesCents), 0)
    const orders = series.reduce((s, d) => s + (current ? d.orders : d.previousOrders), 0)
    const c = customers.rows.find((r) => r.current === current)
    return {
      salesCents,
      orders,
      averageOrderCents: orders ? Math.round(salesCents / orders) : 0,
      returningCustomerRate: c?.customers ? c.returning / c.customers : 0,
    }
  }

  return {
    current: totals(true),
    previous: totals(false),
    series,
    topProducts: topProducts.rows.map((r) => ({
      productId: r.product_id,
      title: r.title,
      imageUrl: r.image_url,
      salesCents: Number(r.sales),
      units: Number(r.units),
    })),
    attention: attention.rows[0] ?? { unfulfilled: 0, unpaid: 0 },
  }
}
