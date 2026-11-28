// The one code box at checkout: a buyer types a discount code or a gift card code and this says which it is and what it does.
// Lives here because gift cards sit above cart and pricing; the guessing limit is cart's (see code-guesses).
import { CartError, cartService, type Cart } from '@shopnex/cart'
import type { Conn } from '@shopnex/db'
import { discountService } from '@shopnex/pricing'
import { lookup } from './gift-cards'

/** What to tell the buyer: `error`, or what the code was. A gift card is only checked: it is spent when the order is placed. */
export type CheckoutCodeResult = {
  error?: string
  kind?: 'discount' | 'giftCard'
  code?: string
  balanceCents?: number
}

const EXPIRED = 'This cart has expired.'

async function checkGiftCard(cart: Cart, code: string, ip: string | null, conn: Conn) {
  const { currency } = await cartService.view(cart, conn)
  const found = await lookup(cart.shopId, code, { currency, ip, throttle: true }, conn)
  if (!found.card) return { error: found.error } satisfies CheckoutCodeResult
  return { kind: 'giftCard', code, balanceCents: found.card.balanceCents } satisfies CheckoutCodeResult
}

async function applyDiscount(shopId: string, token: string, code: string, ip: string | null, conn: Conn) {
  try {
    const view = await cartService.setDiscountCode(shopId, token, code, conn, { ip })
    if (!view.discountCode?.applicable) {
      await cartService.setDiscountCode(shopId, token, null, conn)
      const discount = await discountService.findByCode(shopId, code, conn)
      return {
        error: !discount
          ? 'Enter a valid code'
          : (discountService.unavailableReason(discount) ?? `Your order doesn't qualify for "${discount.code}" yet`),
      } satisfies CheckoutCodeResult
    }
  } catch (error) {
    if (error instanceof CartError) return { error: error.message } satisfies CheckoutCodeResult
    throw error
  }
  return { kind: 'discount' } satisfies CheckoutCodeResult
}

/**
 * A discount code if the shop has one by that name, otherwise a gift card. `ip` is the visitor's address (null when it can't be
 * trusted): wrong codes count against them, and a visitor who used up their guesses is refused before any lookup.
 * Anything unexpected is thrown for the caller to log; what the buyer should read is in `error`.
 */
export async function applyCode(
  token: string,
  raw: string,
  ip: string | null,
  conn: Conn,
): Promise<CheckoutCodeResult> {
  const code = raw.trim()
  if (!code) return { error: 'Enter a discount or gift card code' }
  const cart = await cartService.findByToken(null, token, conn)
  if (!cart) return { error: EXPIRED }
  if (await discountService.findByCode(cart.shopId, code, conn))
    return applyDiscount(cart.shopId, token, code, ip, conn)
  return checkGiftCard(cart, code, ip, conn)
}
