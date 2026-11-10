import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// DATABASE_URL is a PostgreSQL connection string, or `pglite:<directory>` / `pglite:memory` for the embedded
// database (PGlite, PostgreSQL compiled to WebAssembly, running inside this process: no server to install).
// Embedded is for trying ShopNex out: one process owns the data, so nothing else can open it.
const EMBEDDED_PREFIX = 'pglite:'
const databaseUrl = process.env.DATABASE_URL ?? ''
export const isEmbeddedDatabase = databaseUrl.startsWith(EMBEDDED_PREFIX)

type Embedded = { migrate: () => Promise<void> }
// `$client` is the pg Pool (tests and scripts use it); on the embedded database it is the PGlite instance instead
type Database = NodePgDatabase<typeof schema> & { $client: Pool }
type Created = { db: Database; embedded?: Embedded; pool?: Pool }

// Where the migrations are: SHOPNEX_MIGRATIONS_DIR, next to this module (source), or relative to the working
// directory (a built server, started from the repository or from apps/admin-ui)
function migrationsFolder() {
  const candidates = [
    process.env.SHOPNEX_MIGRATIONS_DIR,
    fileURLToPath(new URL('../migrations', import.meta.url)),
    join(process.cwd(), 'modules/db/migrations'),
    join(process.cwd(), '../../modules/db/migrations'),
  ].filter((dir): dir is string => !!dir)
  const found = candidates.find((dir) => existsSync(join(dir, 'meta/_journal.json')))
  if (!found)
    throw new Error(
      `Cannot find the database migrations (looked in ${candidates.join(', ')}). Set SHOPNEX_MIGRATIONS_DIR.`,
    )
  return found
}

async function createEmbedded(): Promise<Created> {
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ])
  const location = databaseUrl.slice(EMBEDDED_PREFIX.length).replace(/^\/\/(?=\/)/, '')
  console.log(`[db] embedded PGlite (${location === 'memory' ? 'in memory, lost on exit' : location})`)
  const client = new PGlite(location === 'memory' ? undefined : location)
  const embedded = drizzlePglite({ client, schema })
  return {
    // Same query API as node-postgres (select, insert, transaction, execute); only the result type of execute differs
    db: embedded as unknown as Database,
    embedded: {
      migrate: () => migrate(embedded, { migrationsFolder: migrationsFolder() }),
    },
  }
}

async function createDb(): Promise<Created> {
  if (isEmbeddedDatabase) return createEmbedded()
  const pool = new Pool({ connectionString: databaseUrl })
  // Where, never the credentials
  const target = (() => {
    try {
      const url = new URL(databaseUrl)
      return `${url.hostname}:${url.port || 5432}${url.pathname}`
    } catch {
      return 'DATABASE_URL'
    }
  })()
  console.log(`[db] PostgreSQL ${target}`)
  return { db: drizzle({ client: pool, schema }), pool }
}

const globalForDb = globalThis as unknown as { shopnexDb?: Created }

// Reuse the pool (or the embedded database, which must not be opened twice) across hot reloads in dev
const created = (globalForDb.shopnexDb ??= await createDb())
export const db = created.db

let prepared: Promise<void> | undefined
/**
 * Called once at server start. With the embedded database it applies the migrations (a server-side Postgres is
 * migrated by `pnpm db:migrate`, or the deploy's migration step), so a fresh data directory just works.
 */
export function prepareDatabase() {
  return (prepared ??= created.embedded ? created.embedded.migrate() : Promise.resolve())
}

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
// Services accept either, so they can run standalone or inside a transaction
export type Conn = Db | Tx
export { schema }

// Promise.all for queries on `conn`: parallel on the pool, one after another inside a transaction
// (a transaction is a single connection, which runs one query at a time — pg warns, and pg 9 will throw).
export async function all<T extends readonly unknown[]>(
  conn: Conn,
  queries: readonly [...{ [K in keyof T]: () => Promise<T[K]> }],
): Promise<T> {
  if (conn === db) return (await Promise.all(queries.map((q) => q()))) as unknown as T
  const results: unknown[] = []
  for (const q of queries) results.push(await q())
  return results as unknown as T
}

// In-process queue per key, for the embedded database (one process owns it, so no other process to wait for)
const embeddedLocks = new Map<number, Promise<unknown>>()

/**
 * Runs `fn` while holding an app-wide lock named by `key`: concurrent callers wait their turn, also across server
 * processes on PostgreSQL (a session advisory lock on a connection of its own, so `fn` is free to use `db`).
 * Embedded there is only this process, so a queue is enough.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T> {
  if (!created.pool) {
    const run = (embeddedLocks.get(key) ?? Promise.resolve()).then(fn, fn)
    embeddedLocks.set(
      key,
      run.catch(() => {}),
    )
    return run
  }
  const client = await created.pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [key])
    return await fn()
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]).catch(() => {})
    client.release()
  }
}
