import { readFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import { parse } from './args'
import { pickApp } from './apps'
import { pickExtras, type Extra } from './extras'
import { bundleDir, isEdge, isInstalled, resolveBundle } from './bundle'
import type { Plan } from './plan'
import { UnavailableError, UsageError } from './errors'
import { assertNode } from './node-version'
import { dataDirOf, ensureSecret, resolveShopDir } from './paths'
import { brandBadge } from './theme'
import { assertPortsFree, runPlan } from './run'

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

Creates the folder <name> (shopnex when you leave it out) and keeps the shop's database in it.
Starts the admin (with the API and checkout) and the storefront on an embedded database. Nothing else to install.
This is for trying ShopNex out: one process owns the data. For a real shop use Docker or PostgreSQL.

Options
  --port <n>               admin, API and checkout (default 3000)
  --storefront-port <n>    storefront (default 4321)
  --no-open                do not open the browser
  --with <apps>            also start optional apps: stripe, cj, shippo (comma separated, or repeat the flag)
  --app <name>             what to start (default shop; a picker appears once there is more than one)
  --verbose                show the output of the servers while they start
  --dry-run                show what would run and exit
  -h, --help               this text
  -v, --version            the version
`

export function describe({
  shopDir,
  plan,
  source,
  extras = [],
}: {
  shopDir: string
  plan: Plan
  source: string
  extras?: Extra[]
}) {
  return [
    `Source      ${source}`,
    `Folder      ${shopDir}`,
    `Admin       ${plan.appUrl}/admin`,
    `Storefront  ${plan.storefrontUrl}`,
    ...extras.map((extra) => `${extra.label.padEnd(11)} http://localhost:${extra.port} (install it from the admin)`),
  ].join('\n')
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
  const dataDir = dataDirOf(shopDir)
  const extras = pickExtras(options.with)
  // A taken port is checked before anything is downloaded
  const ports = [
    { port: options.port, flag: '--port' },
    { port: options.storefrontPort, flag: '--storefront-port' },
    ...extras.map((extra) => ({ port: extra.port, flag: `--with (${extra.name} needs it free)` })),
  ]
  if (!options.dryRun) await assertPortsFree(ports)

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
    dataDir,
    port: options.port,
    storefrontPort: options.storefrontPort,
    secret: options.dryRun ? '' : ensureSecret(dataDir),
  })

  p.note(describe({ shopDir, plan, source, extras }), app.label)
  if (options.dryRun) return p.outro('Dry run: nothing was started.')
  p.log.warn('This is a trial database: it is not for production.')
  process.exitCode = await runPlan(plan, { open: options.open, verbose: options.verbose })
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
