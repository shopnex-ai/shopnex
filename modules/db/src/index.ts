import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof createDb> }

function createDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return drizzle({ client: pool, schema })
}

// Reuse the pool across Next.js hot reloads in dev
export const db = globalForDb.db ?? createDb()
if (process.env.NODE_ENV !== 'production') globalForDb.db = db

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
