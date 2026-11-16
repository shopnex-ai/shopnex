import { readFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import { UnavailableError, UsageError } from '@shopnex/cli-core/errors'
import { assertNode } from '@shopnex/cli-core/node-version'
import { brandBadge } from '@shopnex/cli-core/theme'
import { COMMANDS, parse } from './args'
import { migrateDb } from './migrate-db'

type Pkg = { version: string; engines: { node: string } }
// The build bundles package.json's version and engines into __PKG__; from the sources (tsx) it is read from the file
declare const __PKG__: Pkg | undefined
const pkg: Pkg =
  typeof __PKG__ !== 'undefined'
    ? __PKG__
    : JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const HELP = `shopnex ${pkg.version}: look after a ShopNex shop made with create-shopnex.

Usage
  shopnex <command> [options]

Commands
  migrate-db    move the shop's data from the embedded database to PostgreSQL

Options
  --to <url>        migrate-db: the PostgreSQL address, an empty database (postgres://user:password@host:5432/shopnex)
  --to-env <NAME>   migrate-db: read that address from the environment variable NAME, so the password stays out of
                    the shell history
  --dir <folder>    the shop's folder (default: the current folder)
  --port <n>        the admin's port, to check the shop is stopped (default 3000)
  -h, --help        this text
  -v, --version     the version

Run it in the shop's folder, with the shop stopped. A copy of the old data is kept next to it.
`

async function run(argv: string[]) {
  const options = parse(argv)
  if (options.version) return void console.log(pkg.version)
  if (options.help || !options.command) return void console.log(HELP)
  if (!(COMMANDS as readonly string[]).includes(options.command)) {
    throw new UsageError(`Unknown command "${options.command}". Run shopnex --help.`)
  }
  assertNode(process.versions.node, pkg.engines.node)
  p.intro(brandBadge(` shopnex ${options.command} ${pkg.version} `))
  await migrateDb({ ...options, version: pkg.version })
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
