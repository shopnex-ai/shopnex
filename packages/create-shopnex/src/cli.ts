import { readFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import { parse } from './args'
import { pickApp } from './apps'
import { bundleDir, isInstalled, resolveBundle } from './bundle'
import { checkCheckout, type Plan } from './checkout'
import { UnavailableError, UsageError } from './errors'
import { assertNode } from './node-version'
import { ensureSecret, resolveDataDir } from './paths'
import { resetData } from './reset'
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
  create-shopnex [options]

Starts the admin (with the API and checkout) and the storefront on an embedded database. Nothing else to install.
This is for trying ShopNex out: one process owns the data. For a real shop use Docker or PostgreSQL.

Options
  --data <folder>          where the database lives (default ~/.shopnex/data); the same folder is the same shop
  --port <n>               admin, API and checkout (default 3000)
  --storefront-port <n>    storefront (default 4321)
  --no-open                do not open the browser
  --reset --yes            delete the data folder and start from an empty shop
  --app <name>             what to start (default shop; a picker appears once there is more than one)
  --verbose                show the output of the servers while they start
  --from <folder>          run from a ShopNex checkout in development mode, instead of the downloaded build
  --dry-run                show what would run and exit
  -h, --help               this text
  -v, --version            the version
`

export function describe({ dataDir, plan, source }: { dataDir: string; plan: Plan; source: string }) {
  return [
    `Source      ${source}`,
    `Data        ${dataDir}`,
    `Admin       ${plan.appUrl}/admin`,
    `Storefront  ${plan.storefrontUrl}`,
  ].join('\n')
}

async function run(argv: string[]) {
  const options = parse(argv)
  if (options.help) return void console.log(HELP)
  if (options.version) return void console.log(pkg.version)
  assertNode(process.versions.node, pkg.engines.node)
  p.intro(brandBadge(` create-shopnex ${pkg.version} `))

  const dataDir = resolveDataDir(options.data)
  if (options.reset) {
    if (options.dryRun) return p.outro(`--reset would delete ${dataDir} (needs --yes).`)
    p.log.info(resetData(dataDir, { yes: options.yes }))
    if (!options.from) return
  }

  // A dry run never downloads: it shows where the build would be unpacked
  const source = options.from ? 'checkout' : 'bundle'
  const root = options.from
    ? checkCheckout(options.from)
    : options.dryRun
      ? bundleDir(pkg.version)
      : await resolveBundle({ version: pkg.version })
  const sourceLabel = options.from
    ? `checkout ${root}`
    : `ShopNex ${pkg.version} ${isInstalled(pkg.version) ? '(downloaded)' : '(downloaded on the first run)'}`
  const app = await pickApp(options.app, { interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) })
  const plan = app.plan({
    source,
    root,
    dataDir,
    port: options.port,
    storefrontPort: options.storefrontPort,
    secret: source === 'bundle' && !options.dryRun ? ensureSecret(dataDir) : '',
  })

  p.note(describe({ dataDir, plan, source: sourceLabel }), app.label)
  if (options.dryRun) return p.outro('Dry run: nothing was started.')
  await assertPortsFree(plan.ports)
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
