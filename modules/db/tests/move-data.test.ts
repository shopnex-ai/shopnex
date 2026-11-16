// The copier behind `shopnex migrate-db`, run on two in-memory PGlite databases (it only needs something that runs SQL).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import {
  MoveDataError,
  assertSchemaVersion,
  assertTargetEmpty,
  emptyTables,
  listTables,
  moveData,
  resetTarget,
  sortByForeignKeys,
  type Queryable,
} from '../src/move-data'

const folder = join(import.meta.dirname, '../migrations')
const journal = (
  JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { when: number }[] }
).entries

const wrap = (client: PGlite): Queryable => ({
  query: async (sql, params) => (await client.query(sql, params)).rows as never,
})
const migrated = async () => {
  const client = new PGlite()
  await migrate(drizzle({ client }), { migrationsFolder: folder })
  return client
}

// Every column type the schema uses, a foreign key, a serial, and values that break naive copying
const MINI = `
  create table shops (id uuid primary key, name text not null, active boolean not null);
  create table items (
    n serial primary key,
    shop_id uuid not null references shops(id),
    qty integer,
    price numeric(7,4),
    meta jsonb,
    tags text[],
    made_at timestamp with time zone,
    day timestamp without time zone,
    note text
  );`

test('values keep their type and spelling, in foreign-key order, and the serial continues after the copy', async () => {
  const [from, to] = [new PGlite(), new PGlite()]
  try {
    for (const client of [from, to]) await client.exec(MINI)
    const shop = '11111111-1111-1111-1111-111111111111'
    await from.query(`insert into shops values ($1, $2, true), ($3, 'two', false)`, [
      shop,
      'Ünïcode "quoted"\nnewline',
      '22222222-2222-2222-2222-222222222222',
    ])
    await from.query(
      `insert into items (n, shop_id, qty, price, meta, tags, made_at, day, note) values
         (7, $1, 3, 12.34, '{"a":[1,"x",null],"b":{"c":true}}', '{"a,b","c\\"d",NULL}', '2026-01-02 03:04:05.678+02', '2026-01-02 03:04:05', 'it''s'),
         (9, $1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      [shop],
    )

    const copied = await moveData(wrap(from), wrap(to))
    assert.deepEqual(copied, { items: 2, shops: 2 })

    for (const table of ['shops order by id', 'items order by n']) {
      const [a, b] = await Promise.all(
        [from, to].map((c) =>
          c.query(`select t::text as row from ${table.split(' ')[0]} t ${table.slice(table.indexOf(' '))}`),
        ),
      )
      assert.deepEqual(b!.rows, a!.rows, table)
    }
    const next = await to.query(`insert into items (shop_id) values ($1) returning n`, [shop])
    assert.equal((next.rows[0] as { n: number }).n, 10, 'the sequence continues after the largest copied value')
  } finally {
    await Promise.all([from.close(), to.close()])
  }
})

test('a failure in the middle leaves the target without a single copied row', async () => {
  const [from, to] = [new PGlite(), new PGlite()]
  try {
    for (const client of [from, to]) await client.exec(MINI)
    // The target refuses the second item: shops (copied first) must not stay behind
    await to.exec(`alter table items add constraint small check (n < 8)`)
    const shop = '11111111-1111-1111-1111-111111111111'
    await from.query(`insert into shops values ($1, 'one', true)`, [shop])
    await from.query(`insert into items (n, shop_id) values (1, $1), (9, $1)`, [shop])

    await assert.rejects(moveData(wrap(from), wrap(to)), /small/)
    assert.deepEqual(
      (await to.query(`select (select count(*) from shops)::int as s, (select count(*) from items)::int as i`)).rows,
      [{ s: 0, i: 0 }],
    )
  } finally {
    await Promise.all([from.close(), to.close()])
  }
})

test('a target with another schema is refused before anything is copied', async () => {
  const [from, to] = [new PGlite(), new PGlite()]
  try {
    await from.exec(MINI)
    await to.exec(`create table items (n int, shop_id uuid, qty int, price numeric(7,4), meta jsonb, tags text[],
      made_at timestamptz, day timestamp, note text)`)
    await to.exec(`create table shops (id uuid primary key, name text not null)`)
    await assert.rejects(moveData(wrap(from), wrap(to)), /table shops has no column active/)
    await assert.rejects(moveData(wrap(from), wrap(new PGlite())), /no table items/)
  } finally {
    await Promise.all([from.close(), to.close()])
  }
})

test('tables are ordered so a table comes after the ones it points to; a circle or a self-reference is an error', () => {
  const t = (name: string) => ({ name, columns: [] })
  const order = sortByForeignKeys(
    [t('c'), t('b'), t('a')],
    [
      ['c', 'b'],
      ['b', 'a'],
      ['c', 'a'],
    ],
  ).map((x) => x.name)
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.throws(
    () =>
      sortByForeignKeys(
        [t('a'), t('b')],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    /in a circle \(a, b\)/,
  )
  assert.throws(() => sortByForeignKeys([t('a')], [['a', 'a']]), /points to itself/)
})

test('the real schema: every table is found, none points in a circle, and the shop moves as it is, seed rows included', async () => {
  const [from, to] = [await migrated(), await migrated()]
  try {
    const tables = await listTables(wrap(from))
    assert.ok(tables.length > 50, `found ${tables.length} tables`)
    // The migrations seed rows, and the shop may have changed them
    const [{ n }] = (await from.query(`select count(*)::int as n from shops`)).rows as [{ n: number }]
    assert.ok(n > 0, 'a migrated database has a seeded shop: the test would prove nothing otherwise')
    await from.query(`update shops set name = 'My own shop name'`)

    // A future migration that adds a self-reference or a circle must teach moveData about it first
    await emptyTables(wrap(to))
    const copied = await moveData(wrap(from), wrap(to))
    assert.equal(Object.keys(copied).length, tables.length)
    for (const { name } of tables) {
      const [a, b] = await Promise.all(
        [from, to].map((c) => c.query(`select t::text as row from "${name}" t order by 1`)),
      )
      assert.deepEqual(b!.rows, a!.rows, name)
    }
  } finally {
    await Promise.all([from.close(), to.close()])
  }
})

test('only an empty target is accepted, and a reset puts a half-made one back', async () => {
  const to = new PGlite()
  try {
    await assertTargetEmpty(wrap(to))
    await migrate(drizzle({ client: to }), { migrationsFolder: folder })
    await assert.rejects(assertTargetEmpty(wrap(to)), /not empty/)
    await resetTarget(wrap(to))
    await assertTargetEmpty(wrap(to))
  } finally {
    await to.close()
  }
})

test('the schema version of the shop must be the one of this build', async () => {
  const db = await migrated()
  try {
    await assertSchemaVersion(wrap(db), journal)
    // The build knows one migration more: the shop's database is older
    await assert.rejects(
      assertSchemaVersion(wrap(db), [...journal, { when: journal.at(-1)!.when + 1 }]),
      /older ShopNex/,
    )
    // The build knows one less: the shop's database is newer
    await assert.rejects(assertSchemaVersion(wrap(db), journal.slice(0, -1)), /newer ShopNex/)
    await assert.rejects(assertSchemaVersion(wrap(new PGlite()), journal), /no ShopNex tables/)
    await assert.rejects(assertSchemaVersion(wrap(db), []), (error) => error instanceof MoveDataError)
  } finally {
    await db.close()
  }
})
