// For apps that keep their own data: one folder (mount it as a volume) with the app's identity and a SQLite database.
//
//   const store = await openLocalStore()                       // DATA_DIR, default ./.data
//   const shopnex = createShopnexApp({ clientId: 'app_x', appKey: store.appKey, data: store.dataFor })
//
// `dataFor` is `shop.data` (settings, encrypted secrets) on SQLite instead of Shopnex; `store.db` is the same
// database for the app's own tables. Back up the folder; lose it and the app is a new app (merchants reconnect).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { generateKeyPair } from '@shopnex/marketplace-sdk/keys'
import { createAppData, deriveDataKey, type AppData, type KeyValue } from './admin'

export type LocalStore = {
  /** The app's private key (snxk_…), created on first start. It never leaves this folder. */
  appKey: string
  /** app.db: `kv` is the shop data below; add your own tables */
  db: DatabaseSync
  /** `shop.data` for one shop of one instance */
  dataFor(instance: string, shopId: string): AppData
}

export async function openLocalStore(options: { dir?: string } = {}): Promise<LocalStore> {
  const dir = options.dir ?? process.env.DATA_DIR ?? '.data'
  mkdirSync(dir, { recursive: true })

  // Kept apart from the database so a copy of app.db alone can't unseal its secrets
  const keyFile = join(dir, 'app-key')
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, (await generateKeyPair()).privateKey, { mode: 0o600, flag: 'wx' })
  }
  chmodSync(keyFile, 0o600)
  const appKey = readFileSync(keyFile, 'utf8').trim()

  const db = new DatabaseSync(join(dir, 'app.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (scope, key)
    ) WITHOUT ROWID;
  `)
  const read = db.prepare('SELECT value FROM kv WHERE scope = ? AND key = ?')
  const write = db.prepare('INSERT OR REPLACE INTO kv (scope, key, value) VALUES (?, ?, ?)')
  const remove = db.prepare('DELETE FROM kv WHERE scope = ? AND key = ?')
  const cipher = deriveDataKey(appKey)

  const kvFor = (scope: string): KeyValue => ({
    async get<T>(key: string) {
      const row = read.get(scope, key) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as T) : null
    },
    async set(key, value) {
      write.run(scope, key, JSON.stringify(value))
    },
    async delete(key) {
      remove.run(scope, key)
    },
  })

  return {
    appKey,
    db,
    dataFor: (instance, shopId) => createAppData(kvFor(`${instance}|${shopId}`), cipher),
  }
}
