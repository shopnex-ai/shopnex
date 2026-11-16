import { parseArgs } from 'node:util'
import { UsageError } from '@shopnex/cli-core/errors'

/** The admin's port when create-shopnex is started without --port: what migrate-db checks to see if the shop runs */
export const DEFAULT_PORT = 3000

export const COMMANDS = ['migrate-db'] as const

export type Options = {
  command: string | undefined
  /** migrate-db: the PostgreSQL address to move to */
  to: string | undefined
  /** migrate-db: the name of an environment variable that holds it (keeps the password out of the shell history) */
  toEnv: string | undefined
  /** The shop's folder; the current folder when left out */
  dir: string
  port: number
  help: boolean
  version: boolean
}

const options = {
  to: { type: 'string' },
  'to-env': { type: 'string' },
  dir: { type: 'string' },
  port: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

/** argv (without node and the script) → the options, with defaults; throws UsageError for anything unknown or invalid */
export function parse(argv: string[]): Options {
  let values
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({ args: argv, options, allowPositionals: true }))
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nRun shopnex --help for the options.`)
  }
  if (positionals.length > 1) throw new UsageError(`Give one command, got: ${positionals.join(' ')}`)
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`--port must be a port number (1-65535), got "${values.port}"`)
  }
  return {
    command: positionals[0],
    to: values.to,
    toEnv: values['to-env'],
    dir: values.dir ?? '.',
    port,
    help: Boolean(values.help),
    version: Boolean(values.version),
  }
}
