import { parseArgs } from 'node:util'
import { UsageError } from '@shopnex/cli-core/errors'

export const DEFAULT_PORT = 3000
export const DEFAULT_STOREFRONT_PORT = 4321

export type Options = {
  /** The shop folder: create-shopnex <name> */
  name: string | undefined
  port: number
  storefrontPort: number
  app: string | undefined
  /** --from: the address of a Shopify or WooCommerce store to bring across once the owner exists */
  from: string | undefined
  /** --with: apps to start next to the shop instead of all of them (names, checked later against extras.ts) */
  with: string[]
  /** --no-apps: start the shop alone, without the bundled apps */
  noApps: boolean
  verbose: boolean
  open: boolean
  dryRun: boolean
  help: boolean
  version: boolean
}

const options = {
  port: { type: 'string' },
  'storefront-port': { type: 'string' },
  app: { type: 'string' },
  from: { type: 'string' },
  with: { type: 'string', multiple: true },
  'no-apps': { type: 'boolean' },
  verbose: { type: 'boolean' },
  'no-open': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

function toPort(name: string, value: string | undefined, fallback: number) {
  if (value === undefined) return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`--${name} must be a port number (1-65535), got "${value}"`)
  }
  return port
}

/** argv (without node and the script) → the options, with defaults; throws UsageError for anything unknown or invalid */
export function parse(argv: string[]): Options {
  let values
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({ args: argv, options, allowPositionals: true }))
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nRun create-shopnex --help for the options.`)
  }
  if (positionals.length > 1) throw new UsageError(`Give one shop name, got: ${positionals.join(' ')}`)
  const port = toPort('port', values.port, DEFAULT_PORT)
  const storefrontPort = toPort('storefront-port', values['storefront-port'], DEFAULT_STOREFRONT_PORT)
  if (port === storefrontPort) throw new UsageError('--port and --storefront-port must be different')
  if (values['no-apps'] && values.with?.length) throw new UsageError('--no-apps and --with cannot be used together')
  const from = values.from?.trim()
  if (values.from !== undefined && !from)
    throw new UsageError('--from needs a store address, e.g. --from my-store.myshopify.com')
  if (from && from.length > 300) throw new UsageError('--from is too long: give the store address, not a page')
  return {
    name: positionals[0],
    port,
    storefrontPort,
    app: values.app,
    from,
    with: values.with ?? [],
    noApps: Boolean(values['no-apps']),
    verbose: Boolean(values.verbose),
    open: !values['no-open'],
    dryRun: Boolean(values['dry-run']),
    help: Boolean(values.help),
    version: Boolean(values.version),
  }
}
