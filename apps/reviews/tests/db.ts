// The app's schema on the embedded database (PostgreSQL in WebAssembly), created by the committed migration, as in production.
import { sql } from 'drizzle-orm'
import { openAppDatabase } from '@shopnex/app/store'
import { migrationsFolder } from '../src/migrations'
import { SCHEMA } from '../src/schema'
import { openStore } from '../src/store'

export async function testDatabase() {
  const database = await openAppDatabase({ databaseUrl: 'pglite:memory', schema: SCHEMA })
  await database.migrate(migrationsFolder())
  return {
    database,
    store: openStore(database.db),
    /** Empty tables, for a test that wants a clean start */
    reset: async () =>
      void (await database.db.execute(sql`truncate ${sql.raw(SCHEMA)}.reviews, ${sql.raw(SCHEMA)}.review_requests`)),
    close: () => database.close(),
  }
}
