import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { Pool } from 'pg'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertPgliteCompatible, dbTarget, ensureDir, repoRoot } from './connection'
import * as schema from './schema'

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof createDb> }

function createDb() {
  const target = dbTarget()
  if (target.kind === 'pglite') {
    ensureDir(target.dir)
    assertPgliteCompatible(target.dir)
    // Typed as the node-postgres database: both are Drizzle's Postgres query builder with the same schema, and
    // services only use that. What differs is `$client`, which only the pool-only helpers below touch.
    return drizzlePglite({ client: new PGlite(target.dir), schema }) as unknown as ReturnType<typeof createPgDb>
  }
  return createPgDb(target.url)
}

function createPgDb(connectionString: string) {
  return drizzle({ client: new Pool({ connectionString }), schema })
}

// Reuse the connection across Next.js hot reloads in dev
export const db = globalForDb.db ?? createDb()
if (process.env.NODE_ENV !== 'production') globalForDb.db = db

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
// Services accept either, so they can run standalone or inside a transaction
export type Conn = Db | Tx
export { schema }
export { dbTarget }

// Embedded Postgres has no deploy step to run `pnpm db:migrate`, and the app is its only process, so the app brings
// the schema up to date itself before serving. Postgres is migrated by `pnpm db:migrate` (deploy/start.sh does).
export async function migrateEmbedded() {
  if (dbTarget().kind !== 'pglite') return
  const migrationsFolder = join(repoRoot(), 'modules/db/migrations')
  if (!existsSync(migrationsFolder)) throw new Error(`Migrations not found at ${migrationsFolder}`)
  await migratePglite(db as never, { migrationsFolder })
}

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

// Runs `fn` while holding an app-wide lock on `key`, also across processes. PGlite is one connection in one
// process, so a plain in-process queue is enough there (and a session lock would deadlock behind its own queries).
const queues = new Map<number, Promise<unknown>>()
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T> {
  if (dbTarget().kind === 'pglite') {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn)
    const tail = run.catch(() => {})
    queues.set(key, tail)
    try {
      return await run
    } finally {
      if (queues.get(key) === tail) queues.delete(key)
    }
  }
  const client = await db.$client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [key])
    return await fn()
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]).catch(() => {})
    client.release()
  }
}
