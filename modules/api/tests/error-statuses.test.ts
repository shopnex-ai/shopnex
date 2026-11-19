// What a route answers when a service throws one of the domain errors: the status of each code, `data.code`, the message and the
// cause. The expectations are the old hand-written ladders of orpc.ts copied as they were (the "oracle"), so this holds before and
// after a class moves to a defineError table: a conversion that changes one answer fails here.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

// Loading the router registers the resolvers, and with them the mapping of the classes not converted yet
await import('../src/router')
const { createProcedures } = await import('@shopnex/rpc')
const { AiError } = await import('@shopnex/ai')
const { AppError } = await import('@shopnex/apps')
const { CartError } = await import('@shopnex/cart')
const { CatalogError } = await import('@shopnex/catalog')
const { ChannelError } = await import('@shopnex/channels')
const { ContentError } = await import('@shopnex/content')
const { EmailError } = await import('@shopnex/email')
const { OrderError } = await import('@shopnex/orders')
const { PaymentError } = await import('@shopnex/payments')
const { DomainError, StaffError } = await import('@shopnex/tenancy')

type Status =
  'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'FORBIDDEN' | 'UNAUTHORIZED' | 'BAD_GATEWAY' | 'TOO_MANY_REQUESTS'
const procedures = createProcedures()

/** What the route answers with when its service throws `error` */
async function answer(error: Error) {
  const route = procedures.pub.handler(() => {
    throw error
  })
  try {
    await call(route as Parameters<typeof call>[0], undefined, { context: { headers: new Headers() } } as never)
  } catch (thrown) {
    return thrown
  }
  return undefined
}

interface Case {
  name: string
  /** The class, to check this list of codes is the class's own */
  cls: unknown
  make: (code: string, message: string) => Error
  codes: string[]
  /** The old ladder */
  status: (code: string) => Status
  /** The old `data` (always `{ code }`, but for AppError) */
  data?: (code: string) => Record<string, unknown>
}

const cases: Case[] = [
  {
    name: 'OrderError',
    cls: OrderError,
    make: (code, message) => new OrderError(code as never, message),
    codes: [
      'EMPTY_ORDER',
      'PRODUCT_NOT_FOUND',
      'VARIANT_NOT_FOUND',
      'VARIANT_REQUIRED',
      'OUT_OF_STOCK',
      'CUSTOMER_NOT_FOUND',
      'ORDER_NOT_FOUND',
      'ORDER_CANCELLED',
      'INVALID_STATUS_TRANSITION',
      'INVALID_REFUND',
      'DISCOUNT_NOT_APPLICABLE',
    ],
    status: (code) =>
      code === 'ORDER_NOT_FOUND'
        ? 'NOT_FOUND'
        : code === 'ORDER_CANCELLED' || code === 'INVALID_STATUS_TRANSITION'
          ? 'CONFLICT'
          : 'BAD_REQUEST',
  },
  {
    name: 'ChannelError',
    cls: ChannelError,
    make: (code, message) => new ChannelError(code as never, message),
    codes: ['CHANNEL_NOT_FOUND', 'HANDLE_TAKEN', 'CHANNEL_PROTECTED', 'CHANNEL_IN_USE'],
    status: (code) =>
      code === 'CHANNEL_NOT_FOUND'
        ? 'NOT_FOUND'
        : code === 'HANDLE_TAKEN' || code === 'CHANNEL_IN_USE' || code === 'CHANNEL_PROTECTED'
          ? 'CONFLICT'
          : 'BAD_REQUEST',
  },
  {
    name: 'CartError',
    cls: CartError,
    make: (code, message) => new CartError(code as never, message),
    codes: [
      'CART_NOT_FOUND',
      'CART_COMPLETED',
      'EMPTY_CART',
      'LINE_NOT_FOUND',
      'VARIANT_NOT_FOUND',
      'OUT_OF_STOCK',
      'INVALID_SHIPPING_RATE',
      'INVALID_PAYMENT_METHOD',
      'NOT_A_CARRIER_APP',
      'INVALID_RATES_URL',
    ],
    status: (code) =>
      code === 'CART_NOT_FOUND' || code === 'VARIANT_NOT_FOUND'
        ? 'NOT_FOUND'
        : code === 'CART_COMPLETED'
          ? 'CONFLICT'
          : code === 'NOT_A_CARRIER_APP'
            ? 'FORBIDDEN'
            : 'BAD_REQUEST',
  },
  {
    name: 'CatalogError',
    cls: CatalogError,
    make: (code, message) => new CatalogError(code as never, message),
    codes: ['SLUG_TAKEN', 'SKU_TAKEN', 'PRODUCT_NOT_FOUND', 'COLLECTION_NOT_FOUND', 'INVALID_VARIANTS', 'HAS_VARIANTS'],
    status: (code) =>
      code === 'SLUG_TAKEN' || code === 'SKU_TAKEN'
        ? 'CONFLICT'
        : code === 'INVALID_VARIANTS' || code === 'HAS_VARIANTS'
          ? 'BAD_REQUEST'
          : 'NOT_FOUND',
  },
  {
    name: 'ContentError',
    cls: ContentError,
    make: (code, message) => new ContentError(code as never, message),
    codes: ['MENU_NOT_FOUND', 'PAGE_NOT_FOUND', 'HANDLE_TAKEN', 'RESOURCE_NOT_FOUND'],
    status: (code) =>
      code === 'HANDLE_TAKEN'
        ? 'CONFLICT'
        : code === 'MENU_NOT_FOUND' || code === 'PAGE_NOT_FOUND'
          ? 'NOT_FOUND'
          : 'BAD_REQUEST',
  },
  {
    name: 'EmailError',
    cls: EmailError,
    make: (code, message) => new EmailError(code as never, message),
    codes: ['EMAIL_FAILED', 'EMAIL_OFF', 'INVALID_TEMPLATE', 'PASSWORD_REQUIRED', 'RECIPIENT_UNKNOWN', 'SEND_LIMIT'],
    status: (code) => (code === 'SEND_LIMIT' ? 'TOO_MANY_REQUESTS' : 'BAD_REQUEST'),
  },
  {
    name: 'AppError',
    cls: AppError,
    make: (code, message) => new AppError(code as never, message),
    codes: [
      'APP_NOT_FOUND',
      'INSTALLATION_NOT_FOUND',
      'MARKETPLACE_NOT_CONNECTED',
      'MARKETPLACE_CONNECT_FAILED',
      'APP_DATA_TOO_LARGE',
      'SCRIPT_URL_INVALID',
      'SCRIPTS_NOT_ALLOWED',
      'invalid_client',
      'invalid_redirect_uri',
      'invalid_scope',
      'invalid_grant',
    ],
    status: (code) =>
      code === 'APP_NOT_FOUND' || code === 'INSTALLATION_NOT_FOUND'
        ? 'NOT_FOUND'
        : code === 'invalid_client'
          ? 'UNAUTHORIZED'
          : code === 'SCRIPTS_NOT_ALLOWED'
            ? 'FORBIDDEN'
            : 'BAD_REQUEST',
    // OAuth clients look for `error` (RFC 6749 §5.2)
    data: (code) => ({ code, error: code }),
  },
  {
    name: 'PaymentError',
    cls: PaymentError,
    make: (code, message) => new PaymentError(code as never, message),
    codes: [
      'SESSION_NOT_FOUND',
      'SESSION_CLOSED',
      'NOT_A_PAYMENTS_APP',
      'INVALID_SESSION_URL',
      'NOT_PAYABLE',
      'PROVIDER_UNAVAILABLE',
    ],
    status: (code) =>
      code === 'SESSION_NOT_FOUND'
        ? 'NOT_FOUND'
        : code === 'SESSION_CLOSED' || code === 'NOT_PAYABLE'
          ? 'CONFLICT'
          : code === 'NOT_A_PAYMENTS_APP'
            ? 'FORBIDDEN'
            : code === 'PROVIDER_UNAVAILABLE'
              ? 'BAD_GATEWAY'
              : 'BAD_REQUEST',
  },
  {
    name: 'AiError',
    cls: AiError,
    make: (code, message) => new AiError(code as never, message),
    codes: [
      'NOT_AN_AI_APP',
      'INVALID_PROVIDER_URL',
      'CAPABILITY_UNAVAILABLE',
      'SUBJECT_NOT_FOUND',
      'SUBJECT_REQUIRED',
      'GENERATION_NOT_FOUND',
      'PROVIDER_FAILED',
      'KEY_REQUIRED',
      'INVALID_PROVIDER_KEY',
    ],
    status: (code) =>
      code === 'SUBJECT_NOT_FOUND' || code === 'GENERATION_NOT_FOUND'
        ? 'NOT_FOUND'
        : code === 'NOT_AN_AI_APP'
          ? 'FORBIDDEN'
          : code === 'PROVIDER_FAILED'
            ? 'BAD_GATEWAY'
            : 'BAD_REQUEST',
  },
  {
    name: 'DomainError',
    cls: DomainError,
    make: (code, message) => new DomainError(code as never, message),
    codes: ['INVALID_DOMAIN', 'DOMAIN_TAKEN', 'DOMAIN_NOT_FOUND'],
    status: (code) =>
      code === 'DOMAIN_NOT_FOUND' ? 'NOT_FOUND' : code === 'DOMAIN_TAKEN' ? 'CONFLICT' : 'BAD_REQUEST',
  },
  {
    name: 'StaffError',
    cls: StaffError,
    make: (code, message) => new StaffError(code as never, message),
    codes: ['NOT_FOUND', 'ALREADY_MEMBER', 'FORBIDDEN'],
    status: (code) => (code === 'ALREADY_MEMBER' ? 'CONFLICT' : (code as Status)),
  },
]

for (const c of cases) {
  describe(`${c.name} through a route`, () => {
    test('the codes tested here are exactly the codes of the class (a new code must be added to this oracle)', () => {
      const statuses = (c.cls as { statuses?: Record<string, string> }).statuses ?? {}
      assert.deepEqual(Object.keys(statuses).sort(), [...c.codes].sort())
    })

    for (const code of c.codes) {
      test(`${code} answers ${c.status(code)}`, async () => {
        const cause = c.make(code, `message of ${code}`)
        const thrown = await answer(cause)
        assert.ok(thrown instanceof ORPCError, `${c.name} ${code} was not mapped`)
        assert.equal(thrown.code, c.status(code))
        assert.equal(thrown.message, `message of ${code}`)
        assert.deepEqual(thrown.data, c.data ? c.data(code) : { code })
        assert.equal(thrown.cause, cause)
      })
    }
  })
}
