import { parseArgs } from 'node:util'
import { UsageError } from './errors'

export const DEFAULT_PORT = 3000
export const DEFAULT_STOREFRONT_PORT = 4321

export type Options = {
  data: string | undefined
  port: number
  storefrontPort: number
  from: string | undefined
  app: string | undefined
  verbose: boolean
  open: boolean
  reset: boolean
  yes: boolean
  dryRun: boolean
  help: boolean
  version: boolean
}

const options = {
  data: { type: 'string' },
  port: { type: 'string' },
  'storefront-port': { type: 'string' },
  from: { type: 'string' },
  app: { type: 'string' },
  verbose: { type: 'boolean' },
  'no-open': { type: 'boolean' },
  reset: { type: 'boolean' },
  yes: { type: 'boolean' },
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
  try {
    ;({ values } = parseArgs({ args: argv, options, allowPositionals: false }))
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nRun create-shopnex --help for the options.`)
  }
  const port = toPort('port', values.port, DEFAULT_PORT)
  const storefrontPort = toPort('storefront-port', values['storefront-port'], DEFAULT_STOREFRONT_PORT)
  if (port === storefrontPort) throw new UsageError('--port and --storefront-port must be different')
  return {
    data: values.data,
    port,
    storefrontPort,
    from: values.from,
    app: values.app,
    verbose: Boolean(values.verbose),
    open: !values['no-open'],
    reset: Boolean(values.reset),
    yes: Boolean(values.yes),
    dryRun: Boolean(values['dry-run']),
    help: Boolean(values.help),
    version: Boolean(values.version),
  }
}
