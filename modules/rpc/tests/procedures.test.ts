// Who may call a route, tested with fake resolvers: no login library, no database, no server. This is what every
// module's routes stand on, so the rules are pinned here: a session, a shop, a bearer token, a scope, a role.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { defineError } from '@shopnex/kit'
import {
  assertRpcConfigured,
  configureRpc,
  createProcedures,
  domainErrorMapper,
  pagination,
  type Resolvers,
  type ShopRole,
} from '../src'
import { type ApiScope, type ApiToken, type Shop } from '@shopnex/core/schema'

const NoteError = defineError('NoteError', { MISSING: 'NOT_FOUND', DUPLICATE: 'CONFLICT' })
const OtherError = defineError('OtherError', { BROKEN: 'BAD_REQUEST' })
// An error that carries more than a code extends the class
class StockError extends defineError('StockError', { OUT_OF_STOCK: 'CONFLICT' }) {
  constructor(
    code: 'OUT_OF_STOCK',
    message: string,
    readonly data: { available: number } = { available: 0 },
  ) {
    super(code, message)
  }
}
const procedures = createProcedures()

const shop = { id: 'shop-1' } as Shop
const token = (scopes: ApiScope[], appId: string | null = null) => ({ scopes, appId }) as unknown as ApiToken
const headers = (init: Record<string, string> = {}) => new Headers(init)
// Loosely typed on purpose: oRPC's procedure types are huge, and the tests assert on what comes back
const run = <T>(procedure: unknown, init: Record<string, string> = {}) =>
  call(procedure as Parameters<typeof call>[0], undefined, {
    context: { headers: headers(init) },
  } as never) as Promise<T>
const refused = (code: string, message?: RegExp) => (error: unknown) =>
  error instanceof ORPCError && error.code === code && (!message || message.test(error.message))

// What the fake login knows
const calls = { session: 0, token: 0 }
let signedIn: { session: { activeOrganizationId: string }; user: { id: string } } | null = null
let membership: { shop: Shop; role: ShopRole; superAdmin: boolean } | null = null
let bearers: Record<string, { shop: Shop; token: ApiToken }> = {}

const resolvers: Resolvers = {
  session: () => {
    calls.session++
    return Promise.resolve(signedIn)
  },
  adminShop: () => Promise.resolve(membership),
  token: (bearer) => {
    calls.token++
    return Promise.resolve(bearers[bearer] ?? null)
  },
  hasScope: (scopes, needed) =>
    scopes.includes(needed) || scopes.includes(needed.replace('read_', 'write_') as ApiScope),
}

const reset = () => {
  calls.session = calls.token = 0
  signedIn = null
  membership = null
  bearers = {}
}

describe('before the app registers its resolvers', () => {
  test('a public route needs none, a route that needs a caller says what is missing', async () => {
    assert.equal(await run(procedures.pub.handler(() => 'open')), 'open')
    await assert.rejects(run(procedures.authed.handler(() => 'x')), /has no resolvers: call configureRpc/)
  })

  test('an entry point that mounts routes can assert it at startup, with the reason', () => {
    assert.throws(() => assertRpcConfigured(), /has no resolvers: call configureRpc/)
  })

  test('an error thrown by a public route is not masked by the missing resolvers', async () => {
    const boom = new Error('boom')
    await assert.rejects(
      run(
        procedures.pub.handler(() => {
          throw boom
        }),
      ),
      (e: unknown) => e === boom,
    )
  })
})

describe('with resolvers', () => {
  before(() => configureRpc(resolvers))

  test('errors a module declares answer with their status and code, others pass through unchanged', async () => {
    const mapped = procedures.pub.handler(() => {
      throw new NoteError('DUPLICATE', 'already there')
    })
    await assert.rejects(run(mapped), (e: unknown) => {
      return (
        e instanceof ORPCError &&
        e.code === 'CONFLICT' &&
        e.message === 'already there' &&
        (e.data as { code: string }).code === 'DUPLICATE'
      )
    })
    const boom = new Error('boom')
    await assert.rejects(
      run(
        procedures.pub.handler(() => {
          throw boom
        }),
      ),
      (e: unknown) => e === boom,
    )
  })

  test('a route’s own mapper comes first, then the default', async () => {
    const own = createProcedures((error) =>
      error instanceof NoteError ? new ORPCError('FORBIDDEN', { message: 'own mapper' }) : undefined,
    )
    const note = own.pub.handler(() => {
      throw new NoteError('MISSING', 'gone')
    })
    await assert.rejects(run(note), refused('FORBIDDEN', /own mapper/))
    // Not the own mapper's: the default answers with what the class declares
    const other = own.pub.handler(() => {
      throw new OtherError('BROKEN', 'broke')
    })
    await assert.rejects(run(other), refused('BAD_REQUEST'))
  })

  test('assertRpcConfigured passes once the resolvers are registered', () => {
    assert.doesNotThrow(() => assertRpcConfigured())
  })

  test('authed: no session is UNAUTHORIZED, a session is given to the handler', async () => {
    reset()
    await assert.rejects(run(procedures.authed.handler(() => 'x')), refused('UNAUTHORIZED'))
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    assert.equal(await run(procedures.authed.handler(({ context }) => context.user.id)), 'u1')
  })

  test('admin: a member of the active shop gets the shop and role, anyone else is FORBIDDEN', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    await assert.rejects(run(procedures.admin.handler(() => 'x')), refused('FORBIDDEN', /Not a member of this shop/))
    membership = { shop, role: 'member', superAdmin: false }
    assert.deepEqual(
      await run(procedures.admin.handler(({ context }) => [context.shop.id, context.role, context.superAdmin])),
      ['shop-1', 'member', false],
    )
  })

  test('adminOrToken: a bearer token wins over the cookie and is never a staff member', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    membership = { shop, role: 'admin', superAdmin: false }
    bearers.sk_good = { shop, token: token(['read_discounts']) }
    const who = procedures.adminOrToken.handler(({ context }) => [context.token !== null, context.role, context.userId])
    assert.deepEqual(await run(who, { authorization: 'Bearer sk_good' }), [true, null, null])
    assert.equal(calls.session, 0)
    assert.deepEqual(await run(who, { authorization: 'bearer sk_good' }), [true, null, null])
  })

  test('adminOrToken: an unknown or revoked token is UNAUTHORIZED; without a bearer the session is used', async () => {
    reset()
    const who = procedures.adminOrToken.handler(({ context }) => [context.token, context.role, context.userId])
    await assert.rejects(
      run(who, { authorization: 'Bearer sk_nope' }),
      refused('UNAUTHORIZED', /Invalid or revoked API token/),
    )
    await assert.rejects(run(who), refused('UNAUTHORIZED'))
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    membership = { shop, role: 'owner', superAdmin: false }
    assert.deepEqual(await run(who), [null, 'owner', 'u1'])
    // Not a bearer header: the session decides
    assert.deepEqual(await run(who, { authorization: 'Basic abc' }), [null, 'owner', 'u1'])
  })

  test('scoped: staff always pass, a token needs the scope (write includes read)', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    membership = { shop, role: 'member', superAdmin: false }
    bearers.sk_read = { shop, token: token(['read_discounts']) }
    bearers.sk_write = { shop, token: token(['write_discounts']) }
    bearers.sk_other = { shop, token: token(['read_orders']) }
    const needsRead = procedures.scoped('read_discounts').handler(() => 'ok')
    assert.equal(await run(needsRead), 'ok')
    assert.equal(await run(needsRead, { authorization: 'Bearer sk_read' }), 'ok')
    assert.equal(await run(needsRead, { authorization: 'Bearer sk_write' }), 'ok')
    await assert.rejects(
      run(needsRead, { authorization: 'Bearer sk_other' }),
      refused('FORBIDDEN', /needs the read_discounts scope/),
    )
    const needsWrite = procedures.scoped('write_discounts').handler(() => 'ok')
    await assert.rejects(run(needsWrite, { authorization: 'Bearer sk_read' }), refused('FORBIDDEN', /write_discounts/))
  })

  test('the app routes want an installed app’s own token: staff and plain API tokens are FORBIDDEN', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    membership = { shop, role: 'admin', superAdmin: false }
    bearers.sk_plain = { shop, token: token(['write_payment_sessions', 'write_ai_capabilities', 'write_shipping']) }
    bearers.sk_app = {
      shop,
      token: token(['write_payment_sessions', 'write_ai_capabilities', 'write_shipping'], 'app-7'),
    }
    for (const [name, procedure, who] of [
      ['payments', procedures.paymentsApp, /payments app/],
      ['ai', procedures.aiApp, /AI app/],
      ['carrier', procedures.carrierApp, /carrier app/],
    ] as const) {
      const handler = procedure.handler(({ context }) => context.appId)
      await assert.rejects(run(handler), refused('FORBIDDEN', who), name)
      await assert.rejects(run(handler, { authorization: 'Bearer sk_plain' }), refused('FORBIDDEN', who), name)
      assert.equal(await run(handler, { authorization: 'Bearer sk_app' }), 'app-7', name)
    }
  })

  test('shopManager: owners, admins and super admins, not members, and not tokens', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    const manage = procedures.shopManager.handler(() => 'ok')
    membership = { shop, role: 'member', superAdmin: false }
    await assert.rejects(run(manage), refused('FORBIDDEN', /owner or admin/))
    for (const role of ['owner', 'admin'] as const) {
      membership = { shop, role, superAdmin: false }
      assert.equal(await run(manage), 'ok', role)
    }
    membership = { shop, role: 'member', superAdmin: true }
    assert.equal(await run(manage), 'ok')
  })

  test('webhookManager: owners and admins or a token (it only sees its own), not members', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    bearers.sk_hook = { shop, token: token(['read_orders']) }
    const hooks = procedures.webhookManager.handler(() => 'ok')
    membership = { shop, role: 'member', superAdmin: false }
    await assert.rejects(run(hooks), refused('FORBIDDEN'))
    assert.equal(await run(hooks, { authorization: 'Bearer sk_hook' }), 'ok')
    membership = { shop, role: 'admin', superAdmin: false }
    assert.equal(await run(hooks), 'ok')
  })

  test('superAdminOnly: only a super admin', async () => {
    reset()
    signedIn = { session: { activeOrganizationId: 'shop-1' }, user: { id: 'u1' } }
    const platform = procedures.superAdminOnly.handler(() => 'ok')
    membership = { shop, role: 'owner', superAdmin: false }
    await assert.rejects(run(platform), refused('FORBIDDEN', /super admin/))
    membership = { shop, role: 'owner', superAdmin: true }
    assert.equal(await run(platform), 'ok')
  })
})

describe('the default answer for errors made with defineError', () => {
  test('is the status the class declares for the code, with the code in data and the error as the cause', () => {
    const cause = new NoteError('MISSING', 'gone')
    const mapped = domainErrorMapper(cause)
    assert.ok(mapped instanceof ORPCError)
    assert.equal(mapped.code, 'NOT_FOUND')
    assert.equal(mapped.message, 'gone')
    assert.deepEqual(mapped.data, { code: 'MISSING' })
    assert.equal(mapped.cause, cause)
  })

  test('a class that extends it, with its own fields, is answered the same way (the fields stay out of the response)', () => {
    const mapped = domainErrorMapper(new StockError('OUT_OF_STOCK', 'Only 2 left', { available: 2 }))
    assert.ok(mapped instanceof ORPCError)
    assert.equal(mapped.code, 'CONFLICT')
    assert.deepEqual(mapped.data, { code: 'OUT_OF_STOCK' })
  })

  test('an error that is not one is left alone, and a code outside its class’s table is a 500, not a guess', () => {
    assert.equal(domainErrorMapper(new Error('boom')), undefined)
    assert.equal(domainErrorMapper('text'), undefined)
    const bad = new NoteError('MISSING', 'x') as unknown as { code: string }
    bad.code = 'NOT_IN_THE_TABLE'
    const mapped = domainErrorMapper(bad as unknown as Error)
    assert.ok(mapped instanceof ORPCError)
    assert.equal(mapped.code, 'INTERNAL_SERVER_ERROR')
  })

  test('works through a route without any mapper registered anywhere', async () => {
    const thrown = createProcedures().pub.handler(() => {
      throw new StockError('OUT_OF_STOCK', 'Only 2 left', { available: 2 })
    })
    await assert.rejects(run(thrown), refused('CONFLICT', /Only 2 left/))
  })
})

describe('helpers', () => {
  test('pagination defaults to 20 from 0, coerces query strings and keeps the limit between 1 and 100', () => {
    assert.deepEqual(pagination.parse({}), { limit: 20, offset: 0 })
    assert.deepEqual(pagination.parse({ limit: '50', offset: '10' }), { limit: 50, offset: 10 })
    assert.throws(() => pagination.parse({ limit: 0 }))
    assert.throws(() => pagination.parse({ limit: 101 }))
    assert.throws(() => pagination.parse({ offset: -1 }))
  })
})
