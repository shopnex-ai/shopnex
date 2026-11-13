import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import { createLogger } from '../src'

const saved = { ...process.env }
let out: { method: string; line: string }[]

beforeEach(() => {
  delete process.env.LOG_LEVEL
  delete process.env.LOG_FORMAT
  out = []
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    mock.method(console, method, (line: string) => out.push({ method, line }))
  }
})

afterEach(() => {
  mock.restoreAll()
  process.env = { ...saved }
})

const lines = () => out.map((o) => o.line)
const json = (index = 0) => JSON.parse(out[index]!.line) as Record<string, unknown>

describe('levels', () => {
  test('info is the default: trace and debug are dropped', () => {
    const log = createLogger('x')
    log.trace('t')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    log.fatal('f')
    assert.deepEqual(
      out.map((o) => o.method),
      ['info', 'warn', 'error', 'error'],
    )
  })

  test('LOG_LEVEL moves the threshold, and is read when logging, so it can change while running', () => {
    const log = createLogger('x')
    process.env.LOG_LEVEL = 'debug'
    log.debug('now visible')
    process.env.LOG_LEVEL = 'error'
    log.warn('now hidden')
    log.error('still here')
    assert.deepEqual(
      out.map((o) => o.method),
      ['debug', 'error'],
    )
  })

  test('trace shows at LOG_LEVEL=trace', () => {
    process.env.LOG_LEVEL = 'trace'
    createLogger('x').trace('very detailed')
    assert.equal(out.length, 1)
  })

  test('silent writes nothing, not even fatal', () => {
    process.env.LOG_LEVEL = 'silent'
    const log = createLogger('x')
    log.fatal('nothing')
    log.error('nothing')
    assert.equal(out.length, 0)
  })

  test('an unknown LOG_LEVEL is info, and the value is case and space tolerant', () => {
    const log = createLogger('x')
    process.env.LOG_LEVEL = 'loud'
    log.debug('hidden')
    log.info('shown')
    process.env.LOG_LEVEL = ' WARN '
    log.info('hidden again')
    assert.equal(out.length, 1)
    assert.equal(log.level, 'warn')
  })

  test('level and isLevelEnabled follow the threshold, like pino', () => {
    const log = createLogger('x')
    assert.equal(log.level, 'info')
    assert.equal(log.isLevelEnabled('debug'), false)
    assert.equal(log.isLevelEnabled('error'), true)
    process.env.LOG_LEVEL = 'silent'
    assert.equal(log.level, 'silent')
    assert.equal(log.isLevelEnabled('fatal'), false)
  })

  test('info goes to console.info, warn to console.warn, error and fatal to console.error, debug and trace to console.debug', () => {
    process.env.LOG_LEVEL = 'trace'
    const log = createLogger('x')
    log.trace('a')
    log.debug('b')
    log.info('c')
    log.warn('d')
    log.error('e')
    log.fatal('f')
    assert.deepEqual(
      out.map((o) => o.method),
      ['debug', 'debug', 'info', 'warn', 'error', 'error'],
    )
  })
})

describe('the arguments of pino', () => {
  test('a message', () => {
    createLogger('payments').info('payment started')
    assert.deepEqual(lines(), ['[payments] payment started'])
  })

  test('an object first, then the message', () => {
    createLogger('payments').info({ sessionId: 'ps_1', shopId: 'default' }, 'payment started')
    assert.deepEqual(lines(), ['[payments] payment started sessionId=ps_1 shopId=default'])
  })

  test('an object alone has no message', () => {
    createLogger('payments').info({ sessionId: 'ps_1' })
    assert.deepEqual(lines(), ['[payments] sessionId=ps_1'])
  })

  test('util.format placeholders in the message', () => {
    const log = createLogger('shipping')
    log.warn('shop %s has %d rates', 'default', 0)
    log.info({ shopId: 'default' }, 'rate %s costs %d', 'flat', 500)
    assert.match(lines()[0]!, /^\[shipping\] WARN shop default has 0 rates$/)
    assert.match(lines()[1]!, /^\[shipping\] rate flat costs 500 shopId=default$/)
  })

  test('an Error alone is logged as err, and its message is the message', () => {
    process.env.LOG_FORMAT = 'json'
    createLogger('x').error(new Error('boom'))
    const entry = json()
    assert.equal(entry.msg, 'boom')
    assert.equal((entry.err as { message: string }).message, 'boom')
  })

  test('an Error with a message keeps the message you gave', () => {
    process.env.LOG_FORMAT = 'json'
    createLogger('x').error(new Error('boom'), 'payment failed')
    assert.equal(json().msg, 'payment failed')
    assert.equal((json().err as { message: string }).message, 'boom')
  })

  test('works without a name', () => {
    createLogger().info('plain')
    assert.deepEqual(lines(), ['plain'])
  })
})

describe('readable output', () => {
  test('warn, error and the others carry their level; info does not', () => {
    process.env.LOG_LEVEL = 'trace'
    const log = createLogger('x')
    log.trace('a')
    log.info('b')
    log.error('c')
    log.fatal('d')
    assert.deepEqual(lines(), ['[x] TRACE a', '[x] b', '[x] ERROR c', '[x] FATAL d'])
  })

  test('values with spaces or quotes are quoted, objects are JSON', () => {
    createLogger('x').info({ note: 'two words', amount: 12, ok: true, none: null, tags: ['a', 'b'] }, 'saved')
    assert.equal(lines()[0], '[x] saved note="two words" amount=12 ok=true none=null tags=["a","b"]')
  })

  test('an error prints its stack under the line, with its code and its cause', () => {
    const cause = new Error('connection refused')
    const err = Object.assign(new Error('Failed to start', { cause }), { code: 'ECONNREFUSED' })
    createLogger('payments').error({ err, sessionId: 'ps_1' }, 'payment session failed')
    const [text] = lines()
    assert.ok(text!.startsWith('[payments] ERROR payment session failed sessionId=ps_1\n'))
    assert.match(text!, /Error: Failed to start\n\s+at /)
    assert.match(text!, /code: ECONNREFUSED/)
    assert.match(text!, /Caused by: Error: connection refused\n\s+at /)
  })
})

describe('JSON output (the shape of pino)', () => {
  beforeEach(() => {
    process.env.LOG_FORMAT = 'json'
  })

  test('has pino’s keys: numeric level, time in ms, pid, hostname, name, msg, then the fields', () => {
    const before = Date.now()
    createLogger('payments').error({ sessionId: 'ps_1' }, 'failed')
    const entry = json()
    assert.deepEqual(Object.keys(entry), ['level', 'time', 'pid', 'hostname', 'name', 'sessionId', 'msg'])
    assert.equal(entry.level, 50)
    assert.ok(typeof entry.time === 'number' && entry.time >= before && entry.time <= Date.now())
    assert.equal(entry.pid, process.pid)
    assert.equal(typeof entry.hostname, 'string')
    assert.equal(entry.name, 'payments')
    assert.equal(entry.msg, 'failed')
  })

  test('uses pino’s level numbers', () => {
    process.env.LOG_LEVEL = 'trace'
    const log = createLogger('x')
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) log[level]('m')
    assert.deepEqual(
      out.map((_, i) => json(i).level),
      [10, 20, 30, 40, 50, 60],
    )
  })

  test('an entry is one line of valid JSON', () => {
    createLogger('x').info({ text: 'line one\nline two' }, 'm')
    assert.equal(lines()[0]!.includes('\n'), false)
    assert.equal(json().text, 'line one\nline two')
  })

  test('an error is { type, message, stack, code, cause } like pino’s err', () => {
    const err = Object.assign(new TypeError('bad', { cause: new Error('why') }), { code: 'E_BAD' })
    createLogger('x').error({ err }, 'failed')
    const e = json().err as Record<string, unknown>
    assert.equal(e.type, 'TypeError')
    assert.equal(e.message, 'bad')
    assert.equal(typeof e.stack, 'string')
    assert.equal(e.code, 'E_BAD')
    assert.equal((e.cause as { message: string }).message, 'why')
  })

  test('reserved keys cannot be taken over by a field', () => {
    createLogger('x').info({ level: 'hacked', msg: 'hacked', name: 'hacked', time: 1 }, 'real')
    const entry = json()
    assert.equal(entry.msg, 'real')
    assert.equal(entry.level, 30)
    assert.equal(entry.name, 'x')
    assert.notEqual(entry.time, 1)
  })

  test('without a message there is no msg key', () => {
    createLogger('x').info({ a: 1 })
    assert.equal('msg' in json(), false)
  })
})

describe('child loggers', () => {
  test('add their bindings to every entry, and the fields of a call win over them', () => {
    const log = createLogger('orders').child({ orderId: 'o1', shopId: 'a' })
    log.info({ shopId: 'b' }, 'updated')
    assert.equal(lines()[0], '[orders] updated orderId=o1 shopId=b')
  })

  test('can be nested, and leave the parent alone', () => {
    const parent = createLogger('x')
    const child = parent.child({ a: 1 }).child({ b: 2 })
    child.info('c')
    parent.info('p')
    assert.deepEqual(lines(), ['[x] c a=1 b=2', '[x] p'])
  })

  test('follow the level of the environment like their parent', () => {
    const child = createLogger('x').child({ a: 1 })
    process.env.LOG_LEVEL = 'error'
    child.info('hidden')
    assert.equal(out.length, 0)
  })
})

describe('what is kept out of the logs', () => {
  test('sensitive keys are redacted at any depth, in text and in JSON', () => {
    const fields = {
      user: 'ada',
      password: 'hunter2',
      nested: { apiKey: 'sk_live_1', Authorization: 'Bearer abc', deeper: [{ clientSecret: 's3', ok: 'fine' }] },
      cookie: 'session=abc',
    }
    createLogger('x').info(fields, 'login')
    process.env.LOG_FORMAT = 'json'
    createLogger('x').info(fields, 'login')
    for (const line of lines()) {
      for (const secret of ['hunter2', 'sk_live_1', 'Bearer abc', 's3', 'session=abc']) {
        assert.equal(line.includes(secret), false, `${secret} leaked: ${line}`)
      }
      assert.ok(line.includes('ada') && line.includes('fine'), 'the rest is kept')
    }
    assert.equal((json(1).nested as { apiKey: string }).apiKey, '[Redacted]')
  })

  test('an error’s extra properties are not copied (a database error holds the query parameters there)', () => {
    const err = Object.assign(new Error('Failed query'), {
      params: ['ada@example.com', 'sk_live_9'],
      query: 'select 1',
    })
    createLogger('x').error({ err }, 'db failed')
    process.env.LOG_FORMAT = 'json'
    createLogger('x').error({ err }, 'db failed')
    for (const line of lines()) {
      assert.equal(line.includes('ada@example.com'), false)
      assert.equal(line.includes('sk_live_9'), false)
    }
    assert.deepEqual(Object.keys(json(1).err as object).sort(), ['message', 'stack', 'type'])
  })
})

describe('never throws, whatever it is given', () => {
  test('a circular object', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    createLogger('x').info({ a }, 'circular')
    process.env.LOG_FORMAT = 'json'
    createLogger('x').info({ a }, 'circular')
    assert.match(lines()[0]!, /\[Circular\]/)
    assert.equal((json(1).a as { self: string }).self, '[Circular]')
  })

  test('a repeated, non-circular object is not called circular', () => {
    const shared = { v: 1 }
    process.env.LOG_FORMAT = 'json'
    createLogger('x').info({ a: shared, b: shared }, 'twice')
    assert.deepEqual(json().a, { v: 1 })
    assert.deepEqual(json().b, { v: 1 })
  })

  test('bigint, symbol, function, undefined and invalid dates', () => {
    process.env.LOG_FORMAT = 'json'
    createLogger('x').info(
      { big: 12n, sym: Symbol('s'), fn: () => 1, nothing: undefined, bad: new Date('x'), when: new Date(0) },
      'odd',
    )
    const entry = json()
    assert.equal(entry.big, '12')
    assert.equal('sym' in entry, false)
    assert.equal('fn' in entry, false)
    assert.equal(entry.bad, null)
    assert.equal(entry.when, '1970-01-01T00:00:00.000Z')
  })

  test('very long strings are shortened', () => {
    process.env.LOG_FORMAT = 'json'
    createLogger('x').info({ body: 'x'.repeat(10_000) }, 'long')
    const body = json().body as string
    assert.ok(body.length < 4100)
    assert.match(body, /… \(6000 more\)$/)
  })

  test('deep objects are cut', () => {
    process.env.LOG_FORMAT = 'json'
    createLogger('x').info({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }, 'deep')
    assert.match(JSON.stringify(json()), /\[Object\]/)
  })

  test('a thrown value that is not an Error', () => {
    createLogger('x').error({ err: 'just a string' }, 'odd throw')
    createLogger('x').error({ err: { code: 5 } }, 'odd throw')
    assert.equal(out.length, 2)
  })
})
