// The public Storefront API's building blocks: the typed errors the contract publishes, and the procedures that implement the contract
// (@shopnex/storefront-sdk) after recognising the shop and the channel the request is for.
import { ORPCError, implement, os } from '@orpc/server'
import { CartError } from '@shopnex/cart'
import { CustomFieldError } from '@shopnex/custom-fields'
import { AccountError } from '@shopnex/customers'
import { EmailError } from '@shopnex/email'
import { OrderError } from '@shopnex/orders'
import type { Context } from '@shopnex/rpc'
import { storefrontContract, storefrontErrorMap, type StorefrontErrorMap } from '@shopnex/storefront-sdk/contract'
import { resolveStorefrontShop } from '@shopnex/tenancy'
import type { z } from 'zod'
import { log } from './log'

const base = os.$context<Context>()

// Storefront errors are part of the published contract: map domain errors to the contract's
// typed errors (code + data) so clients get `defined` errors instead of parsing messages.
// Status and data shape come from the contract's error map, so they can't drift from it.
type ErrorData<C extends keyof StorefrontErrorMap> = StorefrontErrorMap[C] extends { data: z.ZodType }
  ? [data: z.input<StorefrontErrorMap[C]['data']>]
  : []

export const defined = <C extends keyof StorefrontErrorMap>(code: C, message: string, ...[data]: ErrorData<C>) => {
  const config: { status?: number } = storefrontErrorMap[code]
  return new ORPCError(code, { defined: true, status: config.status, message, data })
}

const badRequest = (error: { message: string; code: string }, cause?: Error) =>
  new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code }, ...(cause && { cause }) })

// Each returns the contract's typed error for a domain error, or undefined when the contract has no name for it
function fromCart(error: CartError) {
  switch (error.code) {
    case 'CART_NOT_FOUND':
      return defined('NOT_FOUND', error.message)
    case 'CART_COMPLETED':
      return defined('CART_COMPLETED', error.message)
    case 'EMPTY_CART':
      return defined('EMPTY_CART', error.message)
    case 'LINE_NOT_FOUND':
      return defined('LINE_NOT_FOUND', error.message, { lineIds: error.data.lineIds ?? [] })
    case 'VARIANT_NOT_FOUND':
      return defined('MERCHANDISE_NOT_FOUND', error.message, { merchandiseIds: error.data.variantIds ?? [] })
    case 'OUT_OF_STOCK':
      // Without a variant id the data wouldn't match the contract; leave it to be logged
      return error.data.variantId
        ? defined('OUT_OF_STOCK', error.message, {
            merchandiseId: error.data.variantId,
            available: error.data.available ?? 0,
          })
        : undefined
    case 'INVALID_SHIPPING_RATE':
    case 'INVALID_PAYMENT_METHOD':
    case 'GIFT_CARD_NOT_APPLICABLE':
      return badRequest(error)
  }
}

function fromAccount(error: AccountError) {
  switch (error.code) {
    case 'INVALID_CODE':
      return defined('INVALID_CODE', error.message)
    case 'TOO_MANY_REQUESTS':
      return defined('TOO_MANY_REQUESTS', error.message)
    case 'INVALID_EMAIL':
      return badRequest(error)
  }
}

function fromOrder(error: OrderError) {
  if (error.code === 'OUT_OF_STOCK' && error.data.variantId) {
    return defined('OUT_OF_STOCK', error.message, {
      merchandiseId: error.data.variantId,
      available: error.data.available ?? 0,
    })
  }
  if (error.code === 'VARIANT_NOT_FOUND') {
    return defined('MERCHANDISE_NOT_FOUND', error.message, { merchandiseIds: error.data.variantIds ?? [] })
  }
  return badRequest(error, error)
}

function fromEmail(error: EmailError) {
  if (error.code !== 'EMAIL_OFF' && error.code !== 'EMAIL_FAILED') return undefined
  // Details (SMTP errors) stay in the logs; the shopper only learns that sign-in isn't available
  if (error.code === 'EMAIL_FAILED') log.error({ err: error }, 'sign-in code email failed')
  return defined('CUSTOMER_LOGIN_UNAVAILABLE', 'Sign-in is not available right now')
}

function typedError(error: unknown) {
  if (error instanceof CartError) return fromCart(error)
  if (error instanceof AccountError) return fromAccount(error)
  if (error instanceof CustomFieldError) return badRequest(error)
  if (error instanceof EmailError) return fromEmail(error)
  if (error instanceof OrderError) return fromOrder(error)
  return undefined
}

const storefrontErrors = base.middleware(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    throw typedError(error) ?? error
  }
})

// Public storefront procedures implement the published contract (@shopnex/storefront-sdk).
// Shop and channel come from the publishable key, else the default shop (single) / request host (multi) and
// its Online Store.
export const storefront = implement(storefrontContract)
  .$context<Context>()
  .use(storefrontErrors)
  .use(async ({ context, next }) => {
    const result = await resolveStorefrontShop(context.headers)
    if (!result.ok) {
      throw result.reason === 'invalid_key'
        ? new ORPCError('UNAUTHORIZED', { message: 'Invalid or revoked publishable key' })
        : new ORPCError('NOT_FOUND', { message: 'Shop not found' })
    }
    return next({ context: { shop: result.shop, channelId: result.channelId } })
  })
