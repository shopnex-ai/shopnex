import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Where the embedded database lives unless --data says otherwise: the same shop whichever folder you run it from */
export const defaultDataDir = () => join(homedir(), '.shopnex', 'data')

export function resolveDataDir(option: string | undefined) {
  if (!option) return defaultDataDir()
  const expanded = option === '~' ? homedir() : option.startsWith('~/') ? join(homedir(), option.slice(2)) : option
  return resolve(expanded)
}

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
