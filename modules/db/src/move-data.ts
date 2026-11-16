// Moves the data of a ShopNex database into another database that already has the same tables (the embedded
// PGlite → PostgreSQL, what `shopnex migrate-db` does). It only needs something that runs SQL, so the tests run it
// on two PGlite databases and the command on PGlite → node-postgres.
//
// Every value travels as text and is cast back to its column's type, so no driver-specific parsing can change it
// (timestamps, jsonb, numeric, arrays, uuid). The tables are copied in foreign-key order inside ONE transaction on the
// target: any error and the target is as it was before the copy.

export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}

/** A problem with the databases themselves (wrong version, target not empty, a count that differs): a plain message */
export class MoveDataError extends Error {}

export type Table = { name: string; columns: { name: string; type: string }[] }

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
const qualified = (table: string) => `${quote('public')}.${quote(table)}`

/** The tables of the `public` schema with their columns (generated columns are left out: the database computes them) */
export async function listTables(db: Queryable): Promise<Table[]> {
  const rows = await db.query(`
    select c.relname as "table", a.attname as "column", format_type(a.atttypid, a.atttypmod) as "type"
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    order by c.relname, a.attnum`)
  const tables = new Map<string, Table>()
  for (const row of rows) {
    const name = String(row.table)
    const table = tables.get(name) ?? tables.set(name, { name, columns: [] }).get(name)!
    table.columns.push({ name: String(row.column), type: String(row.type) })
  }
  return [...tables.values()]
}

/** [table, the table it points to] for every foreign key inside `public` */
export async function foreignKeys(db: Queryable): Promise<[string, string][]> {
  const rows = await db.query(`
    select t.relname as "table", r.relname as "references"
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class r on r.oid = c.confrelid
    where c.contype = 'f' and t.relnamespace = 'public'::regnamespace and r.relnamespace = 'public'::regnamespace`)
  return rows.map((row) => [String(row.table), String(row.references)])
}

/**
 * The tables, the ones others point to first. A foreign key that points at its own table or round a circle has no
 * safe order for plain inserts, so that is an error here (the schema has none today; a test keeps it that way).
 */
export function sortByForeignKeys(tables: Table[], keys: [string, string][]): Table[] {
  const names = new Set(tables.map((table) => table.name))
  const waitingFor = new Map(tables.map((table) => [table.name, new Set<string>()]))
  for (const [from, to] of keys) {
    if (from === to) throw new MoveDataError(`Table ${from} points to itself: copying it needs a different order`)
    if (names.has(from) && names.has(to)) waitingFor.get(from)!.add(to)
  }
  const ordered: Table[] = []
  const rest = new Map(tables.map((table) => [table.name, table]))
  while (rest.size) {
    const ready = [...rest.values()].filter((table) => [...waitingFor.get(table.name)!].every((to) => !rest.has(to)))
    if (!ready.length) {
      throw new MoveDataError(`Tables point at each other in a circle (${[...rest.keys()].join(', ')})`)
    }
    for (const table of ready) {
      ordered.push(table)
      rest.delete(table.name)
    }
  }
  return ordered
}

/** The target must hold nothing yet: this moves a shop, it never merges two */
export async function assertTargetEmpty(target: Queryable) {
  const [{ n }] = (await target.query(
    `select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm')`,
  )) as [{ n: number }]
  const [{ migrated }] = (await target.query(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as migrated`,
  )) as [{ migrated: boolean }]
  if (n > 0 || migrated) {
    throw new MoveDataError(
      'The new database is not empty (it has tables already). Point --to at a new, empty database.',
    )
  }
}

/**
 * Takes away what a failed run created on a target that assertTargetEmpty found empty: every table of `public` and
 * the migrations bookkeeping. Never call it on a database that held anything before.
 */
export async function resetTarget(target: Queryable) {
  const tables = await target.query(`select tablename from pg_tables where schemaname = 'public'`)
  for (const row of tables) await target.query(`drop table if exists ${qualified(String(row.tablename))} cascade`)
  await target.query('drop schema if exists drizzle cascade')
}

/**
 * The migrations seed a few rows (a fresh database is not empty of rows), and the shop's own copy of them is the one
 * that counts. Empties every table of `public`. Only for a target this run has just migrated, never for one that
 * held anything before.
 */
export async function emptyTables(target: Queryable) {
  const tables = await listTables(target)
  if (!tables.length) return
  await target.query(
    `truncate table ${tables.map((table) => qualified(table.name)).join(', ')} restart identity cascade`,
  )
}

/**
 * The database must be at the schema the migrations of this build leave: the same number of applied migrations and
 * the same newest one. `journal` is the `entries` of the migrations folder's meta/_journal.json.
 */
export async function assertSchemaVersion(db: Queryable, journal: { when: number }[]) {
  const [{ present }] = (await db.query(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  )) as [{ present: boolean }]
  if (!present)
    throw new MoveDataError('This database has no ShopNex tables: start the shop once, then run this again.')
  const [{ n, last }] = (await db.query(
    `select count(*)::int as n, max(created_at)::text as last from drizzle."__drizzle_migrations"`,
  )) as [{ n: number; last: string | null }]
  const expected = journal.at(-1)?.when
  if (n === journal.length && String(expected) === last) return
  const older = n < journal.length || Number(last) < Number(expected)
  throw new MoveDataError(
    older
      ? `The shop's database is from an older ShopNex (${n} of ${journal.length} migrations applied). Start the shop once with this version, which updates it, stop it, and run this again.`
      : `The shop's database is from a newer ShopNex than this one (${n} migrations, this one knows ${journal.length}). Use the same version that last ran the shop.`,
  )
}

async function copyTable(source: Queryable, target: Queryable, table: Table) {
  const select = table.columns.map((column) => `${quote(column.name)}::text as ${quote(column.name)}`).join(', ')
  const rows = await source.query(`select ${select} from ${qualified(table.name)}`)
  const names = table.columns.map((column) => quote(column.name)).join(', ')
  const batch = Math.max(1, Math.min(500, Math.floor(60000 / table.columns.length)))
  for (let from = 0; from < rows.length; from += batch) {
    const chunk = rows.slice(from, from + batch)
    const params: unknown[] = []
    const values = chunk.map((row) => {
      const placeholders = table.columns.map((column) => {
        params.push(row[column.name] ?? null)
        return `$${params.length}::${column.type}`
      })
      return `(${placeholders.join(', ')})`
    })
    await target.query(
      `insert into ${qualified(table.name)} (${names}) overriding system value values ${values.join(', ')}`,
      params,
    )
  }
  return rows.length
}

/** After the copy the sequences behind serial/identity columns must continue after the largest copied value */
async function resetSequences(target: Queryable) {
  const owned = await target.query(`
    select s.oid::regclass::text as sequence, t.relname as "table", a.attname as "column"
    from pg_class s
    join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
    join pg_class t on t.oid = d.refobjid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
    where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace`)
  for (const row of owned) {
    const column = quote(String(row.column))
    await target.query(
      `select setval($1::regclass, coalesce(max(${column}), 1), max(${column}) is not null) from ${qualified(String(row.table))}`,
      [row.sequence],
    )
  }
}

async function count(db: Queryable, table: string) {
  const [{ n }] = (await db.query(`select count(*)::text as n from ${qualified(table)}`)) as [{ n: string }]
  return Number(n)
}

/**
 * Copies every table of `public` from `source` to `target` (which has the same tables, empty), in one transaction on
 * the target, and checks the row counts before committing. Returns the rows copied per table.
 */
export async function moveData(
  source: Queryable,
  target: Queryable,
  { onTable }: { onTable?: (table: string, rows: number) => void } = {},
) {
  const tables = await listTables(source)
  const there = new Map((await listTables(target)).map((table) => [table.name, table]))
  for (const table of tables) {
    const match = there.get(table.name)
    const missing = table.columns.filter((column) => !match?.columns.some((other) => other.name === column.name))
    if (!match || missing.length) {
      throw new MoveDataError(
        `The new database does not match: ${match ? `table ${table.name} has no column ${missing.map((c) => c.name).join(', ')}` : `no table ${table.name}`}.`,
      )
    }
  }
  const ordered = sortByForeignKeys(tables, await foreignKeys(source))

  const copied: Record<string, number> = {}
  await target.query('begin')
  try {
    for (const table of ordered) {
      copied[table.name] = await copyTable(source, target, table)
      onTable?.(table.name, copied[table.name]!)
    }
    await resetSequences(target)
    for (const table of ordered) {
      const [before, after] = [copied[table.name]!, await count(target, table.name)]
      if (before !== after) {
        throw new MoveDataError(`Table ${table.name} has ${before} rows here and ${after} there after the copy.`)
      }
    }
    await target.query('commit')
  } catch (error) {
    await target.query('rollback').catch(() => {})
    throw error
  }
  return copied
}
