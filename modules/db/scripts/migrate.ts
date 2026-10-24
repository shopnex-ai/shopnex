// Applies the SQL migrations in ./migrations to whatever DATABASE_URL points at (Postgres or PGlite).
// Same journal table as `drizzle-kit migrate`, so databases migrated by either keep working.
import { config } from 'dotenv'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'

config({ path: '../../.env', quiet: true })

const { db, dbTarget } = await import('../src')
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
const target = dbTarget()

if (target.kind === 'pglite') {
  await migratePglite(db as never, { migrationsFolder })
  await (db.$client as unknown as { close(): Promise<void> }).close()
} else {
  await migratePg(db, { migrationsFolder })
  await db.$client.end()
}
console.log(`Migrations applied (${target.kind === 'pglite' ? target.dir : 'postgres'})`)
