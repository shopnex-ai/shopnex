import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { UsageError } from './errors'

/** The shop's folder: the name as given, relative to the folder you run it from (a path like ../shop or ~/shop works too) */
export function resolveShopDir(name: string, cwd = process.cwd()) {
  const trimmed = name.trim()
  if (!trimmed) throw new UsageError('The shop name cannot be empty.')
  const expanded = trimmed === '~' ? homedir() : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
  return resolve(cwd, expanded)
}

/** The embedded database lives in the shop folder */
export const dataDirOf = (shopDir: string) => join(shopDir, 'data')

/** The DATABASE_URL that makes the server use the embedded database in that folder */
export const databaseUrl = (dataDir: string) => `pglite:${dataDir}`

/** Where the downloaded builds are unpacked, one folder per version. SHOPNEX_APP_DIR overrides it. */
export const appCacheDir = () => process.env.SHOPNEX_APP_DIR ?? join(homedir(), '.shopnex', 'app')

/**
 * SHOPNEX_SECRET encrypts the provider keys saved in the admin and signs sessions, and a production server will not
 * start without it. One per shop, kept next to the data folder (not inside it: PGlite owns that folder) so the
 * same shop keeps its sessions and stored keys across runs.
 */
export function ensureSecret(dataDir: string) {
  const file = `${dataDir}.secret`
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
  }
  return readFileSync(file, 'utf8').trim()
}
