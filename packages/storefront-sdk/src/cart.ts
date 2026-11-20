// The buyer's cart, in the browser, for theme scripts: Storefront API calls (plain fetch keeps theme bundles
// small; no zod/oRPC) and nanostores a theme's scripts and islands can subscribe to. The cart id stays in
// localStorage; checkout is ShopNex's hosted page (`cart.checkoutUrl`).
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

/** What the buyer typed for a line: a key and a value (Storefront API attributes) */
export type LineAttribute = { key: string; value: string }

/** The attributes a buyer is shown for a line: without the shop's own (a key that starts with "_") */
export const visibleAttributes = (line: Pick<CartLine, 'attributes'>) =>
  line.attributes.filter((a) => !a.key.startsWith('_'))

const PROPERTY_NAME = /^properties\[(.+)\]$/

/**
 * What the buyer typed on the product page for the variant being added: every field named `properties[Engraving]` (Shopify's
 * convention for line item properties) in the product form, `[data-product-form]`, that holds this variant's add button. A field
 * left empty adds nothing; a `required` one left empty stops the add (the browser points at it, and this throws). Another product's
 * quick-add button, elsewhere on the page, reads nothing.
 */
export function readLineAttributes(merchandiseId: string): LineAttribute[] {
  const form = [...document.querySelectorAll<HTMLElement>('[data-product-form]')].find((f) =>
    [...f.querySelectorAll<HTMLElement>('[data-add-to-cart]')].some(
      (b) => b.getAttribute('data-add-to-cart') === merchandiseId,
    ),
  )
  if (!form) return []
  type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const attributes: LineAttribute[] = []
  for (const field of form.querySelectorAll<Field>('[name^="properties["]')) {
    const key = PROPERTY_NAME.exec(field.name)?.[1]
    if (!key) continue
    const missing = () => {
      field.reportValidity()
      return new Error(`Please fill in “${key}”`)
    }
    // An unchecked box or radio sends nothing, as in a form
    const choice = 'checked' in field && (field.type === 'checkbox' || field.type === 'radio')
    if (choice && !(field as HTMLInputElement).checked) {
      if (field.required && field.type === 'checkbox') throw missing()
      continue
    }
    if (field.required && !field.value.trim()) throw missing()
    if (field.value.trim()) attributes.push({ key, value: field.value })
  }
  return attributes
}

/**
 * Adds a variant. `attributes` is what the buyer typed for the line (an engraving…); left out, it is read from the product page's
 * `properties[Name]` fields (see readLineAttributes). The same variant with other attributes is another line in the cart.
 */
export async function addToCart(merchandiseId: string, quantity = 1, attributes?: LineAttribute[]) {
  await loadCart()
  const typed = attributes ?? readLineAttributes(merchandiseId)
  const lines = [{ merchandiseId, quantity, ...(typed.length ? { attributes: typed } : {}) }]
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
