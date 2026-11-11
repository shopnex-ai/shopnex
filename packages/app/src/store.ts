// For an app that needs real tables of its own (CJ Dropshipping's orders): a Postgres schema of its own, next to
// ShopNex's tables. Most apps don't: their settings and secrets go through `shop.data`, which ShopNex stores.
// Configured by env only, no folder and no files, so a container needs no volume:
//
//   APP_DATABASE_URL   `postgres://…`, or DATABASE_URL when that is a Postgres URL. `pglite:<directory>` is the
//                      embedded database (PostgreSQL in WebAssembly) for trying ShopNex out: one process owns it.
//
//   const database = await openAppDatabase({ schema: 'app_cj' })
//   await database.migrate(migrationsFolder) // a folder made by `drizzle-kit generate`
//   // declare tables with pgSchema('app_cj') and query them with database.db (Drizzle)
import { mkdirSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export type AppDatabase = {
  /** The schema this app owns */
  schema: string
  /** Drizzle on the app's database */
  db: NodePgDatabase
  /** The plain `pg` pool, for anything Drizzle doesn't cover. Not there on the embedded database */
  pool?: Pool
  /** Applies your Drizzle migrations and records them in the app's schema */
  migrate(migrationsFolder: string): Promise<void>
  /** Closes the database */
  close(): Promise<void>
}

export type AppDatabaseOptions = {
  /** `postgres://…` or `pglite:<directory>`. Default: APP_DATABASE_URL, else DATABASE_URL when that is a Postgres URL */
  databaseUrl?: string
  /** The schema the app owns, created when missing. Default: `app` */
  schema?: string
}

export async function openAppDatabase(options: AppDatabaseOptions = {}): Promise<AppDatabase> {
  const schema = options.schema ?? 'app'
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error(`Invalid schema name "${schema}": use lowercase letters, digits and _`)
  const url = options.databaseUrl ?? databaseUrlFromEnv()
  if (!url)
    throw new Error(
      'APP_DATABASE_URL is not set: this app keeps its data in Postgres (postgres://…), or pglite:<directory> to try things out',
    )

  const { db, pool, migrate, close } = await connect(url)
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`))
  return {
    schema,
    db,
    pool,
    migrate: (migrationsFolder) => migrate({ migrationsFolder, migrationsSchema: schema }),
    close,
  }
}

const databaseUrlFromEnv = () => {
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL
  // ShopNex itself may run on the embedded database, which only one process can open: it is not shared with apps
  const url = process.env.DATABASE_URL
  return url && !url.startsWith('pglite:') ? url : undefined
}

type Migration = { migrationsFolder: string; migrationsSchema: string }

async function connect(url: string): Promise<{
  db: NodePgDatabase
  pool?: Pool
  migrate: (config: Migration) => Promise<void>
  close: () => Promise<void>
}> {
  if (url.startsWith('pglite:')) {
    const [{ PGlite }, { drizzle: drizzlePglite }, { migrate }] = await Promise.all([
      import('@electric-sql/pglite'),
      import('drizzle-orm/pglite'),
      import('drizzle-orm/pglite/migrator'),
    ]).catch((error) => {
      throw new Error(
        `The embedded database is not available here (${error.message}): set APP_DATABASE_URL to a Postgres URL`,
      )
    })
    const location = url.slice('pglite:'.length).replace(/^\/\/(?=\/)/, '')
    if (location !== 'memory') mkdirSync(location, { recursive: true })
    const client = new PGlite(location === 'memory' ? undefined : location)
    const db = drizzlePglite({ client })
    // Same query API as node-postgres; only the result type of execute differs
    return {
      db: db as unknown as NodePgDatabase,
      migrate: (config) => migrate(db, config),
      close: () => client.close(),
    }
  }
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool)
  return { db, pool, migrate: (config) => migrate(db, config), close: () => pool.end() }
}
