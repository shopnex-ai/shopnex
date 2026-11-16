// Moves a shop from the embedded database to PostgreSQL. Not imported by the server: the release bundle builds it as
// admin/migrate-db.mjs and `shopnex migrate-db` runs it (see packages/cli). It lives here, next to the schema and the
// migrations, so it is always the version that matches them.
//
//   SOURCE_DATABASE_URL     pglite:<directory>  (the shop must be stopped: one process owns the embedded database)
//   TARGET_DATABASE_URL     postgres://…        (empty: this never merges)
//   SHOPNEX_MIGRATIONS_DIR  the migrations folder of this build
//
// Exit 0: every table copied and its row count checked. Anything else: the target is as it was, and the source was
// only read.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import {
  MoveDataError,
  assertSchemaVersion,
  assertTargetEmpty,
  emptyTables,
  moveData,
  resetTarget,
  type Queryable,
} from './move-data'

const fail = (message: string): never => {
  throw new MoveDataError(message)
}
const need = (name: string) => process.env[name] || fail(`${name} is not set`)

async function run() {
  const sourceUrl = need('SOURCE_DATABASE_URL')
  const targetUrl = need('TARGET_DATABASE_URL')
  const migrations = need('SHOPNEX_MIGRATIONS_DIR')
  if (!sourceUrl.startsWith('pglite:') || sourceUrl === 'pglite:memory') {
    fail('SOURCE_DATABASE_URL must be pglite:<directory>')
  }
  if (!/^postgres(ql)?:\/\//.test(targetUrl)) fail('TARGET_DATABASE_URL must be a postgres:// address')
  const journal = (
    JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as { entries: { when: number }[] }
  ).entries

  const sourceClient = new PGlite(sourceUrl.slice('pglite:'.length))
  await sourceClient.waitReady
  const source: Queryable = { query: async (sql, params) => (await sourceClient.query(sql, params)).rows as never }
  const targetClient = new pg.Client({ connectionString: targetUrl })
  const target: Queryable = { query: async (sql, params) => (await targetClient.query(sql, params)).rows }
  let connected = false

  let created = false
  try {
    await targetClient
      .connect()
      .catch((error: Error) => fail(`Could not connect to the new database: ${error.message}`))
    connected = true
    console.log('Checking the shop’s database')
    await assertSchemaVersion(source, journal)
    await assertTargetEmpty(target)

    console.log('Creating the tables in PostgreSQL')
    created = true
    await migrate(drizzle({ client: targetClient }), { migrationsFolder: migrations })
    await emptyTables(target) // the rows the migrations seed come from the shop's own copy instead

    const copied = await moveData(source, target, {
      onTable: (table, count) => count && console.log(`  ${table}: ${count}`),
    })
    const rows = Object.values(copied).reduce((sum, count) => sum + count, 0)
    console.log(`Copied ${rows} rows from ${Object.keys(copied).length} tables, and checked every count`)
  } catch (error) {
    if (created) {
      console.log('Undoing: removing what was created in PostgreSQL')
      await resetTarget(target).catch((cleanup) => console.error(`Could not clean up: ${(cleanup as Error).message}`))
    }
    throw error
  } finally {
    await sourceClient.close().catch(() => {})
    if (connected) await targetClient.end().catch(() => {})
  }
}

run().then(
  () => process.exit(0),
  (error: Error) => {
    // The stack only for a bug report: a refused insert or a lost connection is explained by the message
    console.error(
      error instanceof MoveDataError || !process.env.DEBUG ? error.message : `${error.message}\n${error.stack ?? ''}`,
    )
    process.exit(1)
  },
)
