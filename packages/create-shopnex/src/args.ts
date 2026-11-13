import { parseArgs } from 'node:util'
import { UsageError } from './errors'

export const DEFAULT_PORT = 3000
export const DEFAULT_STOREFRONT_PORT = 4321

export type Options = {
  /** The shop folder: create-shopnex <name> */
  name: string | undefined
  port: number
  storefrontPort: number
  app: string | undefined
  /** --with: optional apps to start next to the shop (names, checked later against extras.ts) */
  with: string[]
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
  with: { type: 'string', multiple: true },
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
  return {
    name: positionals[0],
    port,
    storefrontPort,
    app: values.app,
    with: values.with ?? [],
    verbose: Boolean(values.verbose),
    open: !values['no-open'],
    dryRun: Boolean(values['dry-run']),
    help: Boolean(values.help),
    version: Boolean(values.version),
  }
}
