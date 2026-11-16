import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import { resolveBundle } from '@shopnex/cli-core/bundle'
import { loadShopEnv, redactUrl, switchDatabaseUrl } from '@shopnex/cli-core/env'
import { UnavailableError, UsageError } from '@shopnex/cli-core/errors'
import { portInUse } from '@shopnex/cli-core/ports'
import { runOnce } from './run-once'

export type MigrateDbOptions = { to?: string; toEnv?: string; dir: string; port: number; version: string }

/** The address to move to, from --to or from the environment variable --to-env names */
export function targetUrl({ to, toEnv }: Pick<MigrateDbOptions, 'to' | 'toEnv'>) {
  if ((to === undefined) === (toEnv === undefined)) {
    throw new UsageError('Give where to move the data: --to postgres://… or --to-env NAME (a variable that holds it).')
  }
  const url = to ?? process.env[toEnv!]?.trim()
  if (!url) throw new UsageError(`${toEnv} is not set.`)
  if (!/^postgres(ql)?:\/\/\S+$/.test(url)) {
    throw new UsageError(`The new database must be a postgres:// address, got "${redactUrl(url)}".`)
  }
  return url
}

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** Folders of optional apps that keep data of their own in the embedded database: it is not moved */
const appsWithData = (shopDir: string) => {
  const apps = join(shopDir, 'apps')
  if (!existsSync(apps)) return []
  return readdirSync(apps).filter((name) => existsSync(join(apps, name, '.pglite')))
}

/**
 * Moves the shop in `dir` from the embedded database to PostgreSQL. The copy itself is admin/migrate-db.mjs of the
 * packaged build (modules/db/src/migrate-db.ts): it matches the schema of that build. This checks the shop is stopped,
 * keeps a copy of the old data, runs it, and only when it says every table was copied points the .env at PostgreSQL.
 */
export async function migrateDb(options: MigrateDbOptions) {
  const target = targetUrl(options)
  const shopDir = resolve(process.cwd(), options.dir)
  if (!existsSync(join(shopDir, '.env'))) {
    throw new UsageError(
      `${shopDir} is not a ShopNex shop (there is no .env in it). Go into the shop's folder, or give it with --dir.`,
    )
  }
  const env = loadShopEnv(shopDir, { write: false })
  if (!env.databaseUrl.startsWith('pglite:')) {
    throw new UsageError(`This shop already uses PostgreSQL (${redactUrl(env.databaseUrl)}): nothing to move.`)
  }
  const data = env.databaseUrl.slice('pglite:'.length)
  if (data === 'memory' || !existsSync(data)) {
    throw new UsageError(`There is no data to move: ${data} does not exist. Start the shop once first.`)
  }
  if (await portInUse(options.port)) {
    throw new UsageError(
      `Something answers on port ${options.port}: stop the shop first (Ctrl+C where it runs). If it runs on another port, give it with --port.`,
    )
  }

  const root = await resolveBundle({ version: options.version, cli: 'shopnex' })
  const script = join(root, 'admin', 'migrate-db.mjs')
  if (!existsSync(script)) {
    throw new UnavailableError(`ShopNex ${options.version} cannot move a database yet (its build has no migrate-db).`)
  }

  const backup = `${data}.bak-${stamp(new Date())}`
  cpSync(data, backup, { recursive: true })
  p.log.info(`A copy of the current data is kept in ${backup} until the move has worked`)

  const code = await runOnce({
    script,
    cwd: join(root, 'admin'),
    env: {
      SOURCE_DATABASE_URL: env.databaseUrl,
      TARGET_DATABASE_URL: target,
      SHOPNEX_MIGRATIONS_DIR: join(root, 'migrations'),
    },
  })
  if (code !== 0) {
    // The script only reads the old data, so the copy made for safety was not needed: a second try would pile up another
    rmSync(backup, { recursive: true, force: true })
    throw new UnavailableError(`Nothing was changed: the shop still uses ${data}.`)
  }

  switchDatabaseUrl(env.file, target)
  const left = appsWithData(shopDir)
  if (left.length) {
    p.log.warn(
      `The data of ${left.map((name) => `apps/${name}`).join(', ')} was not moved: those apps start empty on PostgreSQL. Their old files stay in apps/.`,
    )
  }
  p.outro(
    `The shop now uses ${redactUrl(target)}. Start it again as before; the old data stays in ${data} as a fallback.`,
  )
}
