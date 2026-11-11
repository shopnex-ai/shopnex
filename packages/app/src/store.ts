// For apps that keep their own data: a Postgres schema of their own, holding the shops' data. Configured by env only,
// no folder and no files, so a container needs no volume:
//
//   <NAME>_APP_KEY      the app's private key (snxk_…), named like its <NAME>_APP_URL (STRIPE_APP_KEY); or
//                        SHOPNEX_APP_KEY for a single app. `node scripts/app-keygen.mjs` makes one. Seals the secrets
//                        the app saves and proves its identity to ShopNex: lose it and the app is a new app
//                        (merchants reconnect). Keep it out of the database, so a copy of the database alone can't
//                        unseal them.
//   APP_DATABASE_URL     `postgres://…`, or DATABASE_URL when that is a Postgres URL (the app gets a schema of its
//                        own next to ShopNex's tables). `pglite:<directory>` is the embedded database (PostgreSQL in
//                        WebAssembly) for trying ShopNex out: one process owns it.
//
//   const store = await openLocalStore({ schema: 'app_stripe', appKeyEnv: 'STRIPE_APP_KEY' })
//   const shopnex = createShopnexApp({ clientId: 'app_x', appKey: store.appKey, data: store.dataFor })
//
// `dataFor` is `shop.data` (settings, encrypted secrets) in the app's schema instead of in ShopNex; `store.db` is a
// Drizzle database on the same connection for the app's own tables (declare them with `pgSchema(store.schema)` and
// run their migrations with `store.migrate`).
import { mkdirSync } from 'node:fs'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { pgSchema, text } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { createAppData, deriveDataKey, type AppData, type KeyValue } from './admin'

export type LocalStore = {
  /** The app's private key (snxk_…), from the environment. It never goes into the database */
  appKey: string
  /** The schema this app owns (its `kv` table is here; put your own tables here too) */
  schema: string
  /** Drizzle on the app's database */
  db: NodePgDatabase
  /** The plain `pg` pool, for anything Drizzle doesn't cover. Not there on the embedded database */
  pool?: Pool
  /** Applies your Drizzle migrations (a folder made by `drizzle-kit generate`) and records them in this schema */
  migrate(migrationsFolder: string): Promise<void>
  /** `shop.data` for one shop of one instance */
  dataFor(instance: string, shopId: string): AppData
  /** Closes the database */
  close(): Promise<void>
}

export type LocalStoreOptions = {
  /** The app's private key. Default: the variable named by `appKeyEnv`, else SHOPNEX_APP_KEY */
  appKey?: string
  /** The variable that holds this app's key, next to its <NAME>_APP_URL: STRIPE_APP_KEY */
  appKeyEnv?: string
  /** `postgres://…` or `pglite:<directory>`. Default: APP_DATABASE_URL, else DATABASE_URL when that is a Postgres URL */
  databaseUrl?: string
  /** The schema the app owns, created when missing. Default: `app` */
  schema?: string
}

export async function openLocalStore(options: LocalStoreOptions = {}): Promise<LocalStore> {
  const schema = options.schema ?? 'app'
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error(`Invalid schema name "${schema}": use lowercase letters, digits and _`)
  const keyEnv = options.appKeyEnv ?? 'SHOPNEX_APP_KEY'
  const appKey = (options.appKey ?? process.env[keyEnv] ?? process.env.SHOPNEX_APP_KEY)?.trim()
  if (!appKey?.startsWith('snxk_'))
    throw new Error(
      `${keyEnv} is not set (or is not a snxk_… key): it is the app's private key. Make one with \`node scripts/app-keygen.mjs\` and keep it with the app's settings`,
    )
  const url = options.databaseUrl ?? databaseUrlFromEnv()
  if (!url)
    throw new Error(
      'APP_DATABASE_URL is not set: apps keep their data in Postgres (postgres://…), or pglite:<directory> to try things out',
    )

  const { db, pool, migrate, close } = await connect(url)
  // Tables are always schema-qualified, so this works behind a connection pooler (no search_path needed)
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`))
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS "${schema}".kv (
      scope text NOT NULL,
      key text NOT NULL,
      value text NOT NULL,
      PRIMARY KEY (scope, key)
    )`),
  )
  const kv = pgSchema(schema).table('kv', { scope: text().notNull(), key: text().notNull(), value: text().notNull() })
  const cipher = deriveDataKey(appKey)

  const kvFor = (scope: string): KeyValue => ({
    async get<T>(key: string) {
      const [row] = await db
        .select({ value: kv.value })
        .from(kv)
        .where(and(eq(kv.scope, scope), eq(kv.key, key)))
      return row ? (JSON.parse(row.value) as T) : null
    },
    async set(key, value) {
      const json = JSON.stringify(value)
      await db
        .insert(kv)
        .values({ scope, key, value: json })
        .onConflictDoUpdate({ target: [kv.scope, kv.key], set: { value: json } })
    },
    async delete(key) {
      await db.delete(kv).where(and(eq(kv.scope, scope), eq(kv.key, key)))
    },
  })

  return {
    appKey,
    schema,
    db,
    pool,
    migrate: (migrationsFolder) => migrate({ migrationsFolder, migrationsSchema: schema }),
    dataFor: (instance, shopId) => createAppData(kvFor(`${instance}|${shopId}`), cipher),
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
