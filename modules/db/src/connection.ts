// Which database to open, from DATABASE_URL:
//   postgres://…     PostgreSQL (production)
//   pglite://<dir>   embedded Postgres in a local directory, no server to run (quick start, demos, small shops)
//   unset            pglite in <DATA_DIR>/pglite, or <repo>/.data/pglite (development only: production must choose)
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type DbTarget = { kind: 'postgres'; url: string } | { kind: 'pglite'; dir: string }

export function repoRoot() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    if (dirname(dir) === dir) return process.cwd()
  }
}

export function dbTarget(url = process.env.DATABASE_URL): DbTarget {
  if (!url) {
    // A production deploy that forgot DATABASE_URL must not silently end up on a single-process embedded database
    // (rolling deploys run two instances on one volume, and there are no backups or replicas)
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_URL is not set. Use a Postgres URL, or pglite://<folder> to choose embedded Postgres on purpose.',
      )
    }
    const base = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(repoRoot(), '.data')
    return { kind: 'pglite', dir: join(base, 'pglite') }
  }
  if (url.startsWith('pglite:')) {
    // pglite://./data/db (relative to the repo root) or pglite:///abs/path
    const path = url.slice('pglite:'.length).replace(/^\/\//, '')
    if (!path) throw new Error('DATABASE_URL pglite: needs a directory, e.g. pglite://./.data/pglite')
    return { kind: 'pglite', dir: resolve(path.startsWith('/') ? path : join(repoRoot(), path)) }
  }
  return { kind: 'postgres', url }
}

// PGlite creates the last folder itself but not its parents
export function ensureDir(dir: string) {
  mkdirSync(dirname(dir), { recursive: true })
}

// The Postgres major bundled in the pinned @electric-sql/pglite (exact version in package.json). A data directory
// only opens on the same major, so bumping PGlite to another major needs a dump and restore, not just an update:
// update this together with the pin.
export const PGLITE_PG_MAJOR = 18

// Fails with a clear message instead of an obscure crash when the data directory belongs to another Postgres major
export function assertPgliteCompatible(dir: string) {
  const file = join(dir, 'PG_VERSION')
  if (!existsSync(file)) return
  const found = Number.parseInt(readFileSync(file, 'utf8'), 10)
  if (found !== PGLITE_PG_MAJOR) {
    throw new Error(
      `${dir} holds a PostgreSQL ${found} database, but this Shopnex build embeds PostgreSQL ${PGLITE_PG_MAJOR}. ` +
        `Export the data with the Shopnex version that created it and import it into a Postgres server (DATABASE_URL=postgres://…).`,
    )
  }
}
