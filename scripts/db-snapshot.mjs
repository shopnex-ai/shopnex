// Snapshots and compares the data in a database, for the upgrade test (scripts/upgrade-test.sh).
//
//   node scripts/db-snapshot.mjs snapshot <file>   # every table in the public schema, as JSON
//   node scripts/db-snapshot.mjs compare <before> <after>
//
// An upgrade may add tables, columns and rows. It must not drop a table or a column, lose a row, or change a
// value that was already there. `compare` exits 1 and lists each difference otherwise.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Migration bookkeeping changes on every upgrade by design
const SKIP_SCHEMAS = ['drizzle']

const [command, ...args] = process.argv.slice(2)

if (command === 'snapshot' && args.length === 1) await snapshot(args[0])
else if (command === 'compare' && args.length === 2) compare(args[0], args[1])
else {
  console.error('usage: db-snapshot.mjs snapshot <file> | compare <before> <after>')
  process.exit(2)
}

async function snapshot(file) {
  // `pg` is a dependency of @shopnex/db, not of the repo root
  const require = createRequire(fileURLToPath(new URL('../modules/db/package.json', import.meta.url)))
  const { Client } = require('pg')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows: tables } = await client.query(
      `select table_schema, table_name from information_schema.tables
       where table_type = 'BASE TABLE' and table_schema = 'public' order by 1, 2`,
    )
    const out = {}
    for (const { table_schema, table_name } of tables) {
      if (SKIP_SCHEMAS.includes(table_schema)) continue
      const { rows: pk } = await client.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = $1::regclass and i.indisprimary order by a.attnum`,
        [`"${table_schema}"."${table_name}"`],
      )
      const { rows: columns } = await client.query(
        `select column_name from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`,
        [table_schema, table_name],
      )
      // Each value as text: stable for every type, and what the comparison needs (is it still the same?)
      const names = columns.map((c) => c.column_name)
      const select = names.map((n) => `"${n}"::text as "${n}"`).join(', ')
      const { rows } = await client.query(`select ${select} from "${table_schema}"."${table_name}"`)
      const keyColumns = pk.length ? pk.map((c) => c.attname) : names
      const keyed = {}
      for (const row of rows) {
        const key = JSON.stringify(keyColumns.map((c) => row[c]))
        // Without a primary key, identical rows collapse into one; a count of them is enough here
        keyed[key] = pk.length ? row : { ...row }
      }
      out[table_name] = { columns: names, key: keyColumns, rows: keyed, count: rows.length }
    }
    writeFileSync(file, JSON.stringify(out, null, 1))
    const total = Object.values(out).reduce((n, t) => n + t.count, 0)
    console.log(`Snapshot: ${Object.keys(out).length} tables, ${total} rows -> ${file}`)
  } finally {
    await client.end()
  }
}

function compare(beforeFile, afterFile) {
  const before = JSON.parse(readFileSync(beforeFile, 'utf8'))
  const after = JSON.parse(readFileSync(afterFile, 'utf8'))
  const problems = []
  let checked = 0

  for (const [table, was] of Object.entries(before)) {
    const now = after[table]
    if (!now) {
      problems.push(`table ${table} is gone (${was.count} rows)`)
      continue
    }
    for (const column of was.columns) {
      if (!now.columns.includes(column)) problems.push(`column ${table}.${column} is gone`)
    }
    const kept = was.columns.filter((c) => now.columns.includes(c))
    for (const [key, row] of Object.entries(was.rows)) {
      checked++
      const next = now.rows[key]
      if (!next) {
        problems.push(`${table}: row ${key} is gone`)
        continue
      }
      for (const column of kept) {
        if (row[column] !== next[column]) {
          problems.push(`${table}: row ${key} column ${column} changed: ${clip(row[column])} -> ${clip(next[column])}`)
        }
      }
    }
  }

  if (problems.length) {
    console.error(`Upgrade lost or changed data (${problems.length} differences):`)
    for (const p of problems.slice(0, 50)) console.error(`  - ${p}`)
    if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`)
    process.exit(1)
  }
  console.log(`Upgrade kept all data: ${checked} rows in ${Object.keys(before).length} tables are unchanged.`)
}

function clip(value) {
  if (value === null) return 'null'
  return value.length > 60 ? `${JSON.stringify(value.slice(0, 57))}…` : JSON.stringify(value)
}
