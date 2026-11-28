import { readFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import { parse } from './args'
import { pickApp } from './apps'
import { loadAppKeys } from './app-keys'
import { selectExtras, type Extra } from './extras'
import { bundleDir, isEdge, isInstalled, resolveBundle } from '@shopnex/cli-core/bundle'
import type { Plan } from './plan'
import { UnavailableError, UsageError } from '@shopnex/cli-core/errors'
import { assertNode } from '@shopnex/cli-core/node-version'
import { loadShopEnv, redactUrl } from '@shopnex/cli-core/env'
import { writeScaffold } from './scaffold'
import { resolveShopDir } from '@shopnex/cli-core/paths'
import { brandBadge } from '@shopnex/cli-core/theme'
import { assertPortsFree, portInUse } from '@shopnex/cli-core/ports'
import { runPlan } from './run'

type Pkg = { version: string; engines: { node: string } }
// The build bundles package.json's version and engines into __PKG__; from the sources (tsx) it is read from the file
declare const __PKG__: Pkg | undefined
const pkg: Pkg =
  typeof __PKG__ !== 'undefined'
    ? __PKG__
    : JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const HELP = `create-shopnex ${pkg.version}: try ShopNex on this machine with one command.

Usage
  create-shopnex [name] [options]   (name defaults to shopnex)

Creates the folder <name> (shopnex when you leave it out) with the shop's settings (.env) and, by default, its
database. Change DATABASE_URL in the .env to use PostgreSQL.
Starts the admin (with the API and checkout) and the storefront on an embedded database. Nothing else to install.
This is for trying ShopNex out: one process owns the data. For a real shop use Docker or PostgreSQL.

Options
  --port <n>               admin, API and checkout (default 3000)
  --storefront-port <n>    storefront (default 4321)
  --no-open                do not open the browser
  --with <apps>            start only these apps: stripe, cj, shippo, reviews (comma separated, or repeat the flag)
  --no-apps                start the shop alone, without the bundled apps (all four start by default)
  --from <store>           bring a Shopify or WooCommerce store across (products, pages, look): its address, e.g. my-store.myshopify.com
  --app <name>             what to start (default shop; a picker appears once there is more than one)
  --verbose                show the output of the servers while they start
  --dry-run                show what would run and exit
  -h, --help               this text
  -v, --version            the version
`

export function describe({
  shopDir,
  database,
  plan,
  source,
  extras = [],
  from,
}: {
  shopDir: string
  database: string
  plan: Plan
  source: string
  extras?: Extra[]
  from?: string
}) {
  const rows = [
    ['Source', source],
    ['Folder', shopDir],
    ['Database', redactUrl(database)],
    ['Admin', `${plan.appUrl}/admin`],
    ['Storefront', plan.storefrontUrl],
    ...(from ? [['Import', `${from} (starts after you create the owner)`]] : []),
    ...extras.map((extra) => [extra.label, `http://localhost:${extra.port} (install it from the admin)`]),
  ]
  const width = Math.max(...rows.map(([label]) => label?.length ?? 0)) + 2
  return rows.map(([label, value]) => `${label?.padEnd(width)}${value}`).join('\n')
}

/** The folder of the shop when no name is given */
export const DEFAULT_SHOP_NAME = 'shopnex'

async function run(argv: string[]) {
  const options = parse(argv)
  if (options.help) return void console.log(HELP)
  if (options.version) return void console.log(pkg.version)
  assertNode(process.versions.node, pkg.engines.node)
  p.intro(brandBadge(` create-shopnex ${pkg.version} `))

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const name = options.name ?? DEFAULT_SHOP_NAME
  const shopDir = resolveShopDir(name)
  let extras = selectExtras(options)
  // The shop's .env (made on the first run): its DATABASE_URL decides which database is used
  const shopEnv = loadShopEnv(shopDir, { write: !options.dryRun })
  const scaffoldWarning = options.dryRun ? undefined : await writeScaffold(shopDir, pkg.version)
  if (scaffoldWarning) p.log.warn(scaffoldWarning)
  // A taken port is checked before anything is downloaded
  const ports = [
    { port: options.port, flag: '--port' },
    { port: options.storefrontPort, flag: '--storefront-port' },
  ]
  if (!options.dryRun) {
    await assertPortsFree(ports)
    if (options.with.length) {
      await assertPortsFree(extras.map((extra) => ({ port: extra.port, flag: `--with (${extra.name} needs it free)` })))
    } else {
      // The apps nobody asked for by name are not worth a failed start: skip the one whose port is taken
      const busy = new Set<string>()
      for (const extra of extras) if (await portInUse(extra.port)) busy.add(extra.name)
      for (const name of busy) {
        const extra = extras.find((e) => e.name === name)
        p.log.warn(`Port ${extra?.port} is in use, so ${extra?.label} is not started. --no-apps hides this.`)
      }
      extras = extras.filter((extra) => !busy.has(extra.name))
    }
  }

  // A dry run never downloads: it shows where the build would be unpacked
  const root = options.dryRun ? bundleDir(pkg.version) : await resolveBundle({ version: pkg.version })
  const source = isEdge(pkg.version)
    ? 'ShopNex edge (the latest build from main, checked on every run)'
    : `ShopNex ${pkg.version} ${isInstalled(pkg.version) ? '(downloaded)' : '(downloaded on the first run)'}`
  const app = await pickApp(options.app, { interactive })
  const plan = app.plan({
    root,
    shopDir,
    extras,
    databaseUrl: shopEnv.databaseUrl,
    env: shopEnv.rest,
    port: options.port,
    storefrontPort: options.storefrontPort,
    secret: shopEnv.secret,
    appKeys: loadAppKeys(shopDir, extras, { write: !options.dryRun }),
  })

  p.note(describe({ shopDir, database: shopEnv.databaseUrl, plan, source, extras, from: options.from }), app.label)
  if (options.dryRun) return p.outro('Dry run: nothing was started.')
  p.log.warn('This is a trial database: it is not for production.')
  process.exitCode = await runPlan(plan, { open: options.open, verbose: options.verbose, from: options.from })
}

export async function main(argv: string[]) {
  try {
    await run(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exitCode = 2
    } else if (error instanceof UnavailableError) {
      console.error(error.message)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
