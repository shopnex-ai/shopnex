// Logging for server code: one small logger with the shape of pino (https://getpino.io), no dependency, so moving to
// pino later changes the import and nothing at the call sites.
//
//   const log = createLogger('payments')                              // like pino({ name: 'payments' })
//   log.info('payment started')
//   log.error({ err, sessionId }, 'payment session failed')           // the object first, then the message, like pino
//   log.error(err)                                                    // an Error alone: logged as `err`, its message as msg
//   log.warn('shop %s has no rates', shopId)                          // util.format placeholders
//   const orderLog = log.child({ orderId })                           // every entry of it carries orderId
//
// Environment:
//   LOG_LEVEL   trace | debug | info (default) | warn | error | fatal | silent
//   LOG_FORMAT  `json` writes one pino-shaped JSON line per entry (level as a number, time in ms, pid, hostname, name,
//               msg, then your fields); anything else is readable text: `[payments] ERROR message key=value`
//
// Differences from pino, on purpose:
// - Output is text unless LOG_FORMAT=json (pino is always JSON and pretty-prints through a separate tool).
// - An Error is written as { type, message, stack, code?, cause? } and nothing else. pino's serializer also copies
//   every enumerable property, and on a database error those include the query parameters (emails, tokens).
// - Fields whose key looks sensitive (password, token, secret, authorization, cookie, api key, ...) are replaced with
//   "[Redacted]" at any depth, without configuring paths. Never log request bodies or credentials anyway.
import { hostname } from 'node:os'
import { format } from 'node:util'

export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type Bindings = Record<string, unknown>

/** The call shapes of pino: `(message, ...formatArgs)` or `(object, message?, ...formatArgs)` */
export interface LogFn {
  (message: string, ...args: unknown[]): void
  (object: object, message?: string, ...args: unknown[]): void
}

export interface Logger {
  trace: LogFn
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  fatal: LogFn
  /** A logger that adds `bindings` to every entry */
  child(bindings: Bindings): Logger
  /** The current threshold (LOG_LEVEL), or `silent` */
  readonly level: Level | 'silent'
  isLevelEnabled(level: Level): boolean
}

// pino's numbers: they are what a JSON entry carries as `level`
const RANK: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }
const SILENT = Infinity

function threshold(): Level | 'silent' {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase()
  if (value === 'silent') return 'silent'
  return value && Object.hasOwn(RANK, value) ? (value as Level) : 'info'
}

const rankOf = (level: Level | 'silent') => (level === 'silent' ? SILENT : RANK[level])
const asJson = () => process.env.LOG_FORMAT?.trim().toLowerCase() === 'json'

const SENSITIVE = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential/i
const REDACTED = '[Redacted]'
const MAX_DEPTH = 5
const MAX_STRING = 4000

interface SerializedError {
  type: string
  message: string
  stack?: string
  code?: string | number
  cause?: unknown
}

function serializeError(error: Error, depth: number, seen: WeakSet<object>): SerializedError {
  const out: SerializedError = { type: error.constructor.name || error.name, message: error.message }
  if (error.stack) out.stack = error.stack
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' || typeof code === 'number') out.code = code
  if (error.cause !== undefined && depth < MAX_DEPTH) out.cause = clean(error.cause, depth + 1, seen)
  return out
}

/** What is safe to write: errors reduced, secrets redacted, cycles and depth cut, long strings shortened */
function clean(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) return serializeError(value, depth, seen)
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… (${String(value.length - MAX_STRING)} more)`
      : value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[Object]'
  seen.add(value)
  const result = Array.isArray(value)
    ? value.map((item) => clean(item, depth + 1, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          SENSITIVE.test(key) ? REDACTED : clean(item, depth + 1, seen),
        ]),
      )
  seen.delete(value)
  return result
}

/** pino's argument rules: an Error alone, an object then a message, or a message with format arguments */
function parse(args: unknown[]): { fields: Bindings; message: string | undefined } {
  const [first, ...rest] = args
  if (first instanceof Error)
    return { fields: { err: first }, message: format(...((rest.length ? rest : [first.message]) as [unknown])) }
  if (typeof first === 'object' && first !== null) {
    return { fields: first as Bindings, message: rest.length ? format(...(rest as [unknown])) : undefined }
  }
  return { fields: {}, message: args.length ? format(...(args as [unknown])) : undefined }
}

const PID = process.pid
const HOST = hostname()

function toLine(level: Level, name: string | undefined, fields: Bindings, message: string | undefined): string {
  if (asJson()) {
    // pino's order; a field with a reserved name is dropped, so it can't take their place
    const {
      level: _level,
      time: _time,
      pid: _pid,
      hostname: _hostname,
      name: _name,
      msg: _msg,
      ...data
    } = clean(fields) as Record<string, unknown>
    return JSON.stringify({
      level: RANK[level],
      time: Date.now(),
      pid: PID,
      hostname: HOST,
      ...(name && { name }),
      ...data,
      ...(message !== undefined && { msg: message }),
    })
  }
  const tag = name ? `[${name}] ` : ''
  const label = level === 'info' ? '' : `${level.toUpperCase()} `
  const pairs: string[] = []
  const errors: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE.test(key)) pairs.push(`${key}=${REDACTED}`)
    else if (value instanceof Error) errors.push(describeError(serializeError(value, 0, new WeakSet())))
    else pairs.push(`${key}=${formatValue(clean(value))}`)
  }
  const head = [`${tag}${label}${message ?? ''}`.trimEnd(), ...pairs].filter(Boolean).join(' ')
  return [head, ...errors].join('\n')
}

const isSerializedError = (value: unknown): value is SerializedError =>
  typeof value === 'object' && value !== null && 'type' in value && 'message' in value

function describeError(error: SerializedError): string {
  const lines = [error.stack ?? `${error.type}: ${error.message}`]
  if (error.code !== undefined) lines.push(`  code: ${String(error.code)}`)
  if (isSerializedError(error.cause)) lines.push(`Caused by: ${describeError(error.cause)}`)
  else if (error.cause !== undefined) lines.push(`Caused by: ${formatValue(error.cause)}`)
  return lines.join('\n')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return /^[\w./:@-]+$/.test(value) ? value : JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return JSON.stringify(value) ?? String(value)
}

const WRITE: Record<Level, (line: string) => void> = {
  trace: (line) => console.debug(line),
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
  fatal: (line) => console.error(line),
}

function make(name: string | undefined, bindings: Bindings): Logger {
  const at =
    (level: Level): LogFn =>
    (...args: unknown[]) => {
      if (RANK[level] < rankOf(threshold())) return
      const { fields, message } = parse(args)
      WRITE[level](toLine(level, name, { ...bindings, ...fields }, message))
    }
  return {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: (extra) => make(name, { ...bindings, ...extra }),
    get level() {
      return threshold()
    },
    isLevelEnabled: (level) => RANK[level] >= rankOf(threshold()),
  }
}

/** A logger for one part of the server; `name` is the `[tag]` of the readable output and `name` of the JSON one */
export function createLogger(name?: string): Logger {
  return make(name, {})
}
