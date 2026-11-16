// 0044 moves every amount from hundredths of the main unit to the currency's smallest unit. Runs the real migrations
// on an in-memory PGlite: everything up to 0043, some data, then 0044.
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const folder = join(import.meta.dirname, '../migrations')
const TAG = '0044_minor_units'

test('amounts of zero- and three-decimal currencies are rescaled; two-decimal ones are left alone', async () => {
  const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  assert.equal(journal.entries.at(-1)?.tag, TAG, 'the migration is the newest one: move this test when another follows')

  // Everything before it, in a copy of the folder
  const before = await mkdtemp(join(tmpdir(), 'shopnex-migrations-'))
  await cp(folder, before, { recursive: true })
  await writeFile(
    join(before, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.tag !== TAG) }),
  )
  const client = new PGlite()
  try {
    await migrate(drizzle({ client }), { migrationsFolder: before })
    // Only the amounts matter here, not the rows they hang from
    await client.exec('SET session_replication_role = replica')

    const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
    for (const [shop, currency] of [
      ['jp', 'JPY'],
      ['bh', 'BHD'],
      ['us', 'USD'],
    ] as const) {
      await client.query(`insert into shops (id, name, slug, currency) values ($1, $1, $1, $2)`, [shop, currency])
      await client.query(`insert into products (shop_id, slug, title, price_cents) values ($1, 'p', 'P', 100000)`, [
        shop,
      ])
      await client.query(
        `insert into product_variants (shop_id, product_id, options_key, title, price_cents, compare_at_price_cents)
         values ($1, gen_random_uuid(), '', 'V', 100000, 150000)`,
        [shop],
      )
      await client.query(
        `insert into discounts (shop_id, code, type, value, min_subtotal_cents) values
         ($1, 'FIXED', 'fixed_amount', 50000, 200000), ($1, 'TEN', 'percentage', 10, null)`,
        [shop],
      )
      await client.query(
        `insert into shipping_rates (shop_id, name, price_cents, free_above_cents) values ($1, 'S', 50000, 1000000)`,
        [shop],
      )
      const order = id(shop === 'jp' ? 11 : shop === 'bh' ? 12 : 13)
      await client.query(
        `insert into orders (id, order_number, channel_id, shop_id, email, currency, subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, tax_lines)
         values ($1, 1, $2, $3, 'a@example.com', $4, 100000, 50000, 10000, 5000, 155000, $5::jsonb)`,
        [order, id(2), shop, currency, JSON.stringify([{ title: 'VAT', ratePercent: 10, amountCents: 10000 }])],
      )
      await client.query(
        `insert into order_items (order_id, unit_price_cents, quantity, title, discount_cents) values ($1, 100000, 1, 'I', 5000)`,
        [order],
      )
      await client.query(
        `insert into order_shipping_lines (order_id, title, price_cents, discount_cents) values ($1, 'S', 50000, 0)`,
        [order],
      )
      await client.query(
        `insert into order_transactions (order_id, kind, status, gateway, amount_cents, currency) values ($1, 'sale', 'success', 'app', 155000, $2)`,
        [order, currency],
      )
      await client.query(
        `insert into payment_sessions (shop_id, order_id, app_id, kind, amount_cents, currency, expires_at) values ($1, $2, $3, 'payment', 155000, $4, now())`,
        [shop, order, id(3), currency],
      )
    }

    // The migration itself
    const sql = await readFile(join(folder, `${TAG}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement)

    const one = async <T>(query: string, params: unknown[] = []) => (await client.query<T>(query, params)).rows[0]!
    const p = (shop: string) => one<{ n: number }>(`select price_cents n from products where shop_id = $1`, [shop])
    assert.deepEqual([(await p('jp')).n, (await p('bh')).n, (await p('us')).n], [1000, 1_000_000, 100000])

    const v = (shop: string) =>
      one<{ a: number; b: number }>(
        `select price_cents a, compare_at_price_cents b from product_variants where shop_id = $1`,
        [shop],
      )
    assert.deepEqual(await v('jp'), { a: 1000, b: 1500 })
    assert.deepEqual(await v('bh'), { a: 1_000_000, b: 1_500_000 })
    assert.deepEqual(await v('us'), { a: 100000, b: 150000 })

    const d = (shop: string, code: string) =>
      one<{ value: number; min: number | null }>(
        `select value, min_subtotal_cents min from discounts where shop_id = $1 and code = $2`,
        [shop, code],
      )
    assert.deepEqual(await d('jp', 'FIXED'), { value: 500, min: 2000 })
    assert.deepEqual(await d('bh', 'FIXED'), { value: 500_000, min: 2_000_000 })
    assert.deepEqual(await d('us', 'FIXED'), { value: 50000, min: 200000 })
    // A percentage is not money
    assert.deepEqual(await d('jp', 'TEN'), { value: 10, min: null })

    const r = (shop: string) =>
      one<{ p: number; f: number }>(`select price_cents p, free_above_cents f from shipping_rates where shop_id = $1`, [
        shop,
      ])
    assert.deepEqual(await r('jp'), { p: 500, f: 10000 })
    assert.deepEqual(await r('bh'), { p: 500_000, f: 10_000_000 })
    assert.deepEqual(await r('us'), { p: 50000, f: 1000000 })

    const o = (shop: string) =>
      one<{ subtotal: number; shipping: number; tax: number; discount: number; total: number; tax_line: number }>(
        `select subtotal_cents subtotal, shipping_cents shipping, tax_cents tax, discount_cents discount, total_cents total, (tax_lines->0->>'amountCents')::int tax_line from orders where shop_id = $1`,
        [shop],
      )
    assert.deepEqual(await o('jp'), {
      subtotal: 1000,
      shipping: 500,
      tax: 100,
      discount: 50,
      total: 1550,
      tax_line: 100,
    })
    assert.deepEqual(await o('bh'), {
      subtotal: 1_000_000,
      shipping: 500_000,
      tax: 100_000,
      discount: 50_000,
      total: 1_550_000,
      tax_line: 100_000,
    })
    assert.deepEqual(await o('us'), {
      subtotal: 100000,
      shipping: 50000,
      tax: 10000,
      discount: 5000,
      total: 155000,
      tax_line: 10000,
    })

    const money = async (table: string, column: string, shop: string) =>
      (
        await one<{ n: number }>(
          `select t.${column} n from ${table} t join orders o on o.id = t.order_id where o.shop_id = $1`,
          [shop],
        )
      ).n
    assert.deepEqual(
      [await money('order_items', 'unit_price_cents', 'jp'), await money('order_items', 'discount_cents', 'jp')],
      [1000, 50],
    )
    assert.equal(await money('order_items', 'unit_price_cents', 'bh'), 1_000_000)
    assert.equal(await money('order_items', 'unit_price_cents', 'us'), 100000)
    assert.equal(await money('order_shipping_lines', 'price_cents', 'jp'), 500)
    assert.equal(await money('order_transactions', 'amount_cents', 'jp'), 1550)
    assert.equal(await money('order_transactions', 'amount_cents', 'bh'), 1_550_000)
    assert.equal(await money('order_transactions', 'amount_cents', 'us'), 155000)
    assert.equal(await money('payment_sessions', 'amount_cents', 'jp'), 1550)
    assert.equal(await money('payment_sessions', 'amount_cents', 'bh'), 1_550_000)

    // The helper does not stay behind
    const left = await one<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'shopnex_to_minor'`)
    assert.equal(left.n, 0)
  } finally {
    await client.close()
  }
})
