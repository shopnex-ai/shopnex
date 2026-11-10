import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { parseEnv } from 'node:util'

export const DEFAULT_DATABASE_URL = 'pglite:./data'

export type ShopEnv = {
  /** DATABASE_URL, with a relative pglite: path resolved against the shop folder */
  databaseUrl: string
  /** SHOPNEX_SECRET: encrypts the provider keys saved in the admin and signs sessions; a production server will not start without it */
  secret: string
  /** Everything else in the file: passed to the admin as it is */
  rest: Record<string, string>
  file: string
}

const template = (secret: string) => `# ShopNex: the settings of this shop. Edit, then start it again.
#
# Where the data lives. The default is an embedded database in ./data (PGlite): one process owns it, for trying
# ShopNex out. For a real database use PostgreSQL, for example:
# DATABASE_URL=postgres://user:password@localhost:5432/shopnex
DATABASE_URL=${DEFAULT_DATABASE_URL}

# Encrypts the provider keys saved in the admin and signs sessions. Keep it: a new one logs everyone out and makes the
# saved keys unreadable. Do not share this file.
SHOPNEX_SECRET=${secret}
`

const resolveDatabaseUrl = (url: string, shopDir: string) => {
  if (!url.startsWith('pglite:')) return url
  const path = url.slice('pglite:'.length)
  return isAbsolute(path) ? url : `pglite:${resolve(shopDir, path)}`
}

/** The password of a connection string is not shown on screen */
export const redactUrl = (url: string) => url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')

/**
 * The shop's settings: <shop folder>/.env. It is made on the first run with a fresh SHOPNEX_SECRET and the embedded
 * database, and read on every run, so changing DATABASE_URL there (to PostgreSQL) is all it takes to use another
 * database. A missing DATABASE_URL or SHOPNEX_SECRET is added. A dry run reads it and writes nothing.
 */
export function loadShopEnv(shopDir: string, { write }: { write: boolean }): ShopEnv {
  const file = join(shopDir, '.env')
  const exists = existsSync(file)
  const { DATABASE_URL, SHOPNEX_SECRET, ...rest } = exists
    ? parseEnv(readFileSync(file, 'utf8'))
    : ({} as Record<string, string>)
  const secret = SHOPNEX_SECRET?.trim() || (write ? randomBytes(32).toString('hex') : '')
  const databaseUrl = DATABASE_URL?.trim() || DEFAULT_DATABASE_URL

  if (write) {
    if (!exists) {
      mkdirSync(shopDir, { recursive: true })
      writeFileSync(file, template(secret), { mode: 0o600 })
    } else {
      const missing = [
        DATABASE_URL?.trim() ? '' : `DATABASE_URL=${DEFAULT_DATABASE_URL}`,
        SHOPNEX_SECRET?.trim() ? '' : `SHOPNEX_SECRET=${secret}`,
      ].filter(Boolean)
      if (missing.length)
        appendFileSync(file, `${readFileSync(file, 'utf8').endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`)
    }
  }
  return { databaseUrl: resolveDatabaseUrl(databaseUrl, shopDir), secret, rest: rest as Record<string, string>, file }
}
