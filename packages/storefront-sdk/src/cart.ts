// The buyer's cart, in the browser, for theme scripts: Storefront API calls (plain fetch keeps theme bundles
// small; no zod/oRPC) and nanostores a theme's scripts and islands can subscribe to. The cart id stays in
// localStorage; checkout is Shopnex's hosted page (`cart.checkoutUrl`).
import { atom } from 'nanostores'
import { API_BASE_PATH, PUBLISHABLE_KEY_HEADER } from './constants'
import type { StorefrontOutputs } from './contract'

export type Cart = StorefrontOutputs['cart']['get']
export type CartLine = Cart['lines'][number]

export const $cart = atom<Cart | null>(null)
/** False until the saved cart was loaded */
export const $cartReady = atom(false)
export const $cartOpen = atom(false)
/** The last failed cart action's message, for the theme to show */
export const $cartError = atom<string | null>(null)

export function reportCartError(error: unknown) {
  $cartError.set(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
}

const CART_KEY = 'shopnex-cart'

// From the meta tags the storefront puts in every page's head (`{{ content_for_header }}`)
function config() {
  const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
  return { baseUrl: meta('shopnex-url') ?? '', publishableKey: meta('shopnex-key') || null }
}

class CartError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

async function call(method: string, path: string, body?: unknown): Promise<Cart> {
  const { baseUrl, publishableKey } = config()
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${API_BASE_PATH}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(publishableKey ? { [PUBLISHABLE_KEY_HEADER]: publishableKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new CartError(json?.message ?? `Cart request failed (${res.status})`, json?.code)
  return json as Cart
}

function save(cart: Cart | null) {
  $cart.set(cart)
  try {
    if (cart) localStorage.setItem(CART_KEY, cart.id)
    else localStorage.removeItem(CART_KEY)
  } catch {
    // Private mode: the cart lasts for this page only
  }
}

/** Loads the saved cart once per page (islands may all call it) */
let loading: Promise<void> | null = null
export function loadCart() {
  loading ??= (async () => {
    let id: string | null = null
    try {
      id = localStorage.getItem(CART_KEY)
    } catch {
      // no storage
    }
    if (id) {
      try {
        const cart = await call('GET', `/storefront/carts/${encodeURIComponent(id)}`)
        // A checked-out cart is done: the next add starts a new one
        save(cart.status === 'completed' ? null : cart)
      } catch {
        save(null)
      }
    }
    $cartReady.set(true)
  })()
  return loading
}

export async function addToCart(merchandiseId: string, quantity = 1) {
  await loadCart()
  const lines = [{ merchandiseId, quantity }]
  const current = $cart.get()
  try {
    save(
      current
        ? await call('POST', `/storefront/carts/${encodeURIComponent(current.id)}/lines`, { lines })
        : await call('POST', '/storefront/carts', { lines }),
    )
  } catch (error) {
    // The cart expired or was checked out elsewhere: start a new one
    if (current && error instanceof CartError && (error.code === 'NOT_FOUND' || error.code === 'CART_COMPLETED')) {
      save(await call('POST', '/storefront/carts', { lines }))
    } else {
      throw error
    }
  }
  $cartOpen.set(true)
}

/**
 * Applies a discount code ('' removes it). A code that doesn't apply stays on the cart with
 * `applicable: false` (see `cart.discountCodes`), so the theme can say so.
 */
export async function setDiscountCode(code: string) {
  await loadCart()
  const cart = $cart.get()
  if (!cart) return
  const discountCodes = code.trim() ? [code.trim()] : []
  save(await call('PUT', `/storefront/carts/${encodeURIComponent(cart.id)}/discount-codes`, { discountCodes }))
}

/** 0 removes the line */
export async function setLineQuantity(lineId: string, quantity: number) {
  const cart = $cart.get()
  if (!cart) return
  save(
    await call('PATCH', `/storefront/carts/${encodeURIComponent(cart.id)}/lines`, {
      lines: [{ id: lineId, quantity }],
    }),
  )
}
