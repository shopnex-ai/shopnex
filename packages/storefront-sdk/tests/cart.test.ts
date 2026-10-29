import test, { describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

type FetchCall = {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

function mockCart(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cart_test_123',
    status: 'active',
    lines: [
      {
        id: 'line_1',
        merchandiseId: 'item_1',
        quantity: 1,
      },
    ],
    discountCodes: [],
    checkoutUrl: 'https://checkout.example.com/c/cart_test_123',
    ...overrides,
  }
}

// Global browser mocks setup
let metaStore: Record<string, string> = {}
let storageStore: Record<string, string> = {}
let storageThrows = false
let fetchCalls: FetchCall[] = []
let fetchHandler: (
  call: FetchCall,
) => { status?: number; body?: unknown; ok?: boolean } | Promise<{ status?: number; body?: unknown; ok?: boolean }>

const originalGlobals = {
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  fetch: globalThis.fetch,
}

function restoreGlobalMocks() {
  globalThis.document = originalGlobals.document
  globalThis.localStorage = originalGlobals.localStorage
  globalThis.fetch = originalGlobals.fetch
}

function setupGlobalMocks() {
  metaStore = {
    'shopnex-url': 'https://store.example.com/',
    'shopnex-key': 'pk_test_sample_key',
  }
  storageStore = {}
  storageThrows = false
  fetchCalls = []
  fetchHandler = () => ({ status: 200, body: mockCart(), ok: true })

  // Mock document.querySelector for meta tags
  globalThis.document = {
    querySelector: (selector: string) => {
      const match = selector.match(/meta\[name="([^"]+)"\]/)
      if (match && match[1] in metaStore) {
        return { content: metaStore[match[1]] } as unknown as HTMLMetaElement
      }
      return null
    },
  } as unknown as Document

  // Mock localStorage
  globalThis.localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('Storage access denied')
      return storageStore[key] ?? null
    },
    setItem: (key: string, value: string) => {
      if (storageThrows) throw new Error('QuotaExceededError')
      storageStore[key] = String(value)
    },
    removeItem: (key: string) => {
      if (storageThrows) throw new Error('Storage access denied')
      delete storageStore[key]
    },
    clear: () => {
      storageStore = {}
    },
  } as unknown as Storage

  // Mock global fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value
        })
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k.toLowerCase()] = v
      } else {
        for (const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = String(v)
      }
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const call: FetchCall = { url, method, headers, body }
    fetchCalls.push(call)

    const res = await fetchHandler(call)
    const status = res.status ?? (res.ok === false ? 400 : 200)

    return new Response(res.body !== undefined ? JSON.stringify(res.body) : null, {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const cartModuleUrl = new URL('../src/cart.ts', import.meta.url).href

/** Loads a fresh cart module with isolated module-level state (e.g. `loading` promise) */
async function getFreshCartModule(cacheKey = String(Math.random())) {
  return await import(`${cartModuleUrl}?cache=${cacheKey}`)
}

describe('Storefront SDK Cart Helpers', () => {
  beforeEach(() => {
    setupGlobalMocks()
  })

  afterEach(() => {
    restoreGlobalMocks()
  })

  describe('reportCartError and $cartError', () => {
    test('updates $cartError with error.message when input is an Error', async () => {
      const { $cartError, reportCartError } = await getFreshCartModule()
      assert.equal($cartError.get(), null)

      reportCartError(new Error('Network disconnected'))
      assert.equal($cartError.get(), 'Network disconnected')

      reportCartError(new TypeError('Invalid type provided'))
      assert.equal($cartError.get(), 'Invalid type provided')
    })

    test('updates $cartError with fallback message for non-Error inputs', async () => {
      const { $cartError, reportCartError } = await getFreshCartModule()
      const fallback = 'Something went wrong. Please try again.'

      reportCartError('string error')
      assert.equal($cartError.get(), fallback)

      reportCartError({ message: 'custom object' })
      assert.equal($cartError.get(), fallback)

      reportCartError(null)
      assert.equal($cartError.get(), fallback)

      reportCartError(undefined)
      assert.equal($cartError.get(), fallback)

      reportCartError(500)
      assert.equal($cartError.get(), fallback)
    })
  })

  describe('config and API headers', () => {
    test('sends requests to configured shopnex-url with publishable key and base path', async () => {
      const { addToCart } = await getFreshCartModule()
      metaStore['shopnex-url'] = 'https://myshop.com/store/'
      metaStore['shopnex-key'] = 'pk_live_999'

      await addToCart('prod_1')

      assert.equal(fetchCalls.length, 1)
      assert.equal(fetchCalls[0].url, 'https://myshop.com/store/api/v1/storefront/carts')
      assert.equal(fetchCalls[0].headers['x-shopnex-key'], 'pk_live_999')
      assert.equal(fetchCalls[0].headers['content-type'], 'application/json')
    })

    test('omits x-shopnex-key header when meta tag is absent', async () => {
      const { addToCart } = await getFreshCartModule()
      delete metaStore['shopnex-key']

      await addToCart('prod_1')

      assert.equal(fetchCalls.length, 1)
      assert.equal('x-shopnex-key' in fetchCalls[0].headers, false)
    })
  })

  describe('loadCart', () => {
    test('sets $cartReady=true and leaves $cart=null when localStorage is empty', async () => {
      const { $cart, $cartReady, loadCart } = await getFreshCartModule()

      assert.equal($cart.get(), null)
      assert.equal($cartReady.get(), false)

      await loadCart()

      assert.equal(fetchCalls.length, 0)
      assert.equal($cart.get(), null)
      assert.equal($cartReady.get(), true)
    })

    test('fetches active cart from API and updates $cart when cart id is stored', async () => {
      storageStore['shopnex-cart'] = 'cart_active_1'
      const expectedCart = mockCart({ id: 'cart_active_1', status: 'active' })
      fetchHandler = (call) => {
        assert.equal(call.method, 'GET')
        assert.equal(call.url, 'https://store.example.com/api/v1/storefront/carts/cart_active_1')
        return { status: 200, body: expectedCart, ok: true }
      }

      const { $cart, $cartReady, loadCart } = await getFreshCartModule()
      await loadCart()

      assert.equal(fetchCalls.length, 1)
      assert.deepEqual($cart.get(), expectedCart)
      assert.equal($cartReady.get(), true)
      assert.equal(storageStore['shopnex-cart'], 'cart_active_1')
    })

    test('clears cart and localStorage when retrieved cart status is completed', async () => {
      storageStore['shopnex-cart'] = 'cart_done_1'
      const completedCart = mockCart({ id: 'cart_done_1', status: 'completed' })
      fetchHandler = () => ({ status: 200, body: completedCart, ok: true })

      const { $cart, $cartReady, loadCart } = await getFreshCartModule()
      await loadCart()

      assert.equal(fetchCalls.length, 1)
      assert.equal($cart.get(), null)
      assert.equal($cartReady.get(), true)
      assert.equal('shopnex-cart' in storageStore, false)
    })

    test('clears cart and localStorage when cart fetch fails (e.g. 404 expired)', async () => {
      storageStore['shopnex-cart'] = 'cart_expired'
      fetchHandler = () => ({ status: 404, body: { message: 'Not found', code: 'NOT_FOUND' }, ok: false })

      const { $cart, $cartReady, loadCart } = await getFreshCartModule()
      await loadCart()

      assert.equal(fetchCalls.length, 1)
      assert.equal($cart.get(), null)
      assert.equal($cartReady.get(), true)
      assert.equal('shopnex-cart' in storageStore, false)
    })

    test('handles localStorage throwing on loadCart gracefully', async () => {
      storageThrows = true
      const { $cart, $cartReady, loadCart } = await getFreshCartModule()

      await assert.doesNotReject(async () => {
        await loadCart()
      })

      assert.equal($cart.get(), null)
      assert.equal($cartReady.get(), true)
    })

    test('caches loading promise and only fetches once per session', async () => {
      storageStore['shopnex-cart'] = 'cart_active_1'
      const { loadCart } = await getFreshCartModule()

      await Promise.all([loadCart(), loadCart(), loadCart()])

      assert.equal(fetchCalls.length, 1)
    })
  })

  describe('addToCart', () => {
    test('creates a new cart with lines when initial cart is null', async () => {
      const createdCart = mockCart({ id: 'new_cart_100' })
      fetchHandler = (call) => {
        assert.equal(call.method, 'POST')
        assert.equal(call.url, 'https://store.example.com/api/v1/storefront/carts')
        assert.deepEqual(call.body, { lines: [{ merchandiseId: 'merch_abc', quantity: 2 }] })
        return { status: 200, body: createdCart, ok: true }
      }

      const { $cart, $cartOpen, addToCart } = await getFreshCartModule()
      await addToCart('merch_abc', 2)

      assert.deepEqual($cart.get(), createdCart)
      assert.equal($cartOpen.get(), true)
      assert.equal(storageStore['shopnex-cart'], 'new_cart_100')
    })

    test('defaults quantity to 1 when omitted', async () => {
      const { addToCart } = await getFreshCartModule()
      await addToCart('merch_default')

      assert.equal(fetchCalls.length, 1)
      assert.deepEqual(fetchCalls[0].body, { lines: [{ merchandiseId: 'merch_default', quantity: 1 }] })
    })

    test('adds line to existing cart when cart is already loaded', async () => {
      const initialCart = mockCart({ id: 'cart_existing_1' })
      const updatedCart = mockCart({
        id: 'cart_existing_1',
        lines: [...initialCart.lines, { id: 'line_2', merchandiseId: 'item_2', quantity: 3 }],
      })

      fetchHandler = (call) => {
        if (call.method === 'POST' && call.url.endsWith('/lines')) {
          assert.equal(call.url, 'https://store.example.com/api/v1/storefront/carts/cart_existing_1/lines')
          assert.deepEqual(call.body, { lines: [{ merchandiseId: 'item_2', quantity: 3 }] })
          return { status: 200, body: updatedCart, ok: true }
        }
        return { status: 200, body: initialCart, ok: true }
      }

      const { $cart, $cartOpen, addToCart } = await getFreshCartModule()
      $cart.set(initialCart)

      await addToCart('item_2', 3)

      assert.deepEqual($cart.get(), updatedCart)
      assert.equal($cartOpen.get(), true)
    })

    test('recovers by creating new cart when existing cart returns NOT_FOUND', async () => {
      const initialCart = mockCart({ id: 'stale_cart' })
      const recoveredCart = mockCart({ id: 'recovered_cart_1' })

      fetchHandler = (call) => {
        if (call.url.includes('/lines')) {
          return {
            status: 404,
            body: { message: 'Cart not found', code: 'NOT_FOUND' },
            ok: false,
          }
        }
        if (call.method === 'POST' && call.url.endsWith('/storefront/carts')) {
          return { status: 200, body: recoveredCart, ok: true }
        }
        return { status: 200, body: initialCart, ok: true }
      }

      const { $cart, $cartOpen, addToCart } = await getFreshCartModule()
      $cart.set(initialCart)

      await addToCart('item_fresh', 1)

      assert.equal(fetchCalls.length, 2)
      assert.equal(fetchCalls[0].url.endsWith('/lines'), true)
      assert.equal(fetchCalls[1].url.endsWith('/storefront/carts'), true)
      assert.deepEqual($cart.get(), recoveredCart)
      assert.equal($cartOpen.get(), true)
      assert.equal(storageStore['shopnex-cart'], 'recovered_cart_1')
    })

    test('recovers by creating new cart when existing cart returns CART_COMPLETED', async () => {
      const initialCart = mockCart({ id: 'completed_cart' })
      const recoveredCart = mockCart({ id: 'new_cart_after_completed' })

      fetchHandler = (call) => {
        if (call.url.includes('/lines')) {
          return {
            status: 409,
            body: { message: 'Cart completed', code: 'CART_COMPLETED' },
            ok: false,
          }
        }
        return { status: 200, body: recoveredCart, ok: true }
      }

      const { $cart, addToCart } = await getFreshCartModule()
      $cart.set(initialCart)

      await addToCart('item_next', 1)

      assert.equal(fetchCalls.length, 2)
      assert.deepEqual($cart.get(), recoveredCart)
      assert.equal(storageStore['shopnex-cart'], 'new_cart_after_completed')
    })

    test('re-throws error when API returns generic error', async () => {
      fetchHandler = () => ({
        status: 500,
        body: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
        ok: false,
      })

      const { $cart, $cartOpen, addToCart } = await getFreshCartModule()

      await assert.rejects(async () => {
        await addToCart('item_fail', 1)
      }, /Internal server error/)

      assert.equal($cart.get(), null)
      assert.equal($cartOpen.get(), false)
    })

    test('falls back to a status message when the error body is not JSON', async () => {
      globalThis.fetch = (async () => new Response('<html>Bad gateway</html>', { status: 502 })) as typeof fetch

      const { addToCart } = await getFreshCartModule()

      await assert.rejects(async () => {
        await addToCart('item_fail', 1)
      }, /Cart request failed \(502\)/)
    })

    test('re-throws and keeps the cart closed when recovery after NOT_FOUND also fails', async () => {
      const initialCart = mockCart({ id: 'stale_cart' })
      fetchHandler = (call) => {
        if (call.url.includes('/lines')) {
          return { status: 404, body: { message: 'Cart not found', code: 'NOT_FOUND' }, ok: false }
        }
        return { status: 500, body: { message: 'Could not create cart' }, ok: false }
      }

      const { $cartOpen, $cart, addToCart } = await getFreshCartModule()
      $cart.set(initialCart)

      await assert.rejects(async () => {
        await addToCart('item_fresh', 1)
      }, /Could not create cart/)

      assert.equal(fetchCalls.length, 2)
      assert.equal($cartOpen.get(), false)
    })

    test('does not retry as a new cart when there was no existing cart', async () => {
      fetchHandler = () => ({ status: 404, body: { message: 'Not found', code: 'NOT_FOUND' }, ok: false })

      const { addToCart } = await getFreshCartModule()

      await assert.rejects(async () => {
        await addToCart('item_fail', 1)
      }, /Not found/)

      assert.equal(fetchCalls.length, 1)
    })
  })

  describe('setDiscountCode', () => {
    test('does nothing when $cart is null', async () => {
      const { $cart, setDiscountCode } = await getFreshCartModule()
      assert.equal($cart.get(), null)

      await setDiscountCode('PROMO10')

      assert.equal(fetchCalls.length, 0)
    })

    test('applies trimmed discount code when code is provided', async () => {
      const currentCart = mockCart({ id: 'cart_discount_test' })
      const updatedCart = mockCart({
        id: 'cart_discount_test',
        discountCodes: [{ code: 'SUMMER25', applicable: true }],
      })

      fetchHandler = (call) => {
        assert.equal(call.method, 'PUT')
        assert.equal(call.url, 'https://store.example.com/api/v1/storefront/carts/cart_discount_test/discount-codes')
        assert.deepEqual(call.body, { discountCodes: ['SUMMER25'] })
        return { status: 200, body: updatedCart, ok: true }
      }

      const { $cart, setDiscountCode } = await getFreshCartModule()
      $cart.set(currentCart)

      await setDiscountCode('  SUMMER25  ')

      assert.equal(fetchCalls.length, 1)
      assert.deepEqual($cart.get(), updatedCart)
    })

    test('sends empty discountCodes array when code is empty or whitespace', async () => {
      const currentCart = mockCart({ id: 'cart_discount_remove' })
      const updatedCart = mockCart({ id: 'cart_discount_remove', discountCodes: [] })

      fetchHandler = (call) => {
        assert.equal(call.method, 'PUT')
        assert.deepEqual(call.body, { discountCodes: [] })
        return { status: 200, body: updatedCart, ok: true }
      }

      const { $cart, setDiscountCode } = await getFreshCartModule()
      $cart.set(currentCart)

      await setDiscountCode('')
      assert.equal(fetchCalls.length, 1)

      await setDiscountCode('   ')
      assert.equal(fetchCalls.length, 2)
      assert.deepEqual(fetchCalls[1].body, { discountCodes: [] })
    })

    test('re-throws error on API failure', async () => {
      const currentCart = mockCart({ id: 'cart_discount_err' })
      fetchHandler = () => ({ status: 400, body: { message: 'Invalid discount' }, ok: false })

      const { $cart, setDiscountCode } = await getFreshCartModule()
      $cart.set(currentCart)

      await assert.rejects(async () => {
        await setDiscountCode('BADCODE')
      }, /Invalid discount/)
    })
  })

  describe('setLineQuantity', () => {
    test('does nothing when $cart is null', async () => {
      const { $cart, setLineQuantity } = await getFreshCartModule()
      assert.equal($cart.get(), null)

      await setLineQuantity('line_1', 3)

      assert.equal(fetchCalls.length, 0)
    })

    test('updates line quantity via PATCH /storefront/carts/{id}/lines', async () => {
      const currentCart = mockCart({ id: 'cart_qty_1' })
      const updatedCart = mockCart({
        id: 'cart_qty_1',
        lines: [{ id: 'line_1', merchandiseId: 'item_1', quantity: 5 }],
      })

      fetchHandler = (call) => {
        assert.equal(call.method, 'PATCH')
        assert.equal(call.url, 'https://store.example.com/api/v1/storefront/carts/cart_qty_1/lines')
        assert.deepEqual(call.body, { lines: [{ id: 'line_1', quantity: 5 }] })
        return { status: 200, body: updatedCart, ok: true }
      }

      const { $cart, setLineQuantity } = await getFreshCartModule()
      $cart.set(currentCart)

      await setLineQuantity('line_1', 5)

      assert.equal(fetchCalls.length, 1)
      assert.deepEqual($cart.get(), updatedCart)
    })

    test('allows setting quantity to 0 to remove line', async () => {
      const currentCart = mockCart({ id: 'cart_qty_0' })
      const updatedCart = mockCart({ id: 'cart_qty_0', lines: [] })

      fetchHandler = (call) => {
        assert.equal(call.method, 'PATCH')
        assert.deepEqual(call.body, { lines: [{ id: 'line_1', quantity: 0 }] })
        return { status: 200, body: updatedCart, ok: true }
      }

      const { $cart, setLineQuantity } = await getFreshCartModule()
      $cart.set(currentCart)

      await setLineQuantity('line_1', 0)

      assert.equal(fetchCalls.length, 1)
      assert.deepEqual($cart.get(), updatedCart)
    })

    test('re-throws error on API failure', async () => {
      const currentCart = mockCart({ id: 'cart_qty_err' })
      fetchHandler = () => ({ status: 404, body: { message: 'Line not found' }, ok: false })

      const { $cart, setLineQuantity } = await getFreshCartModule()
      $cart.set(currentCart)

      await assert.rejects(async () => {
        await setLineQuantity('line_999', 1)
      }, /Line not found/)
    })
  })

  describe('Storage resilience (private mode)', () => {
    test('does not throw when localStorage setItem throws (quota/disabled)', async () => {
      storageThrows = true
      const createdCart = mockCart({ id: 'private_cart_1' })
      fetchHandler = () => ({ status: 200, body: createdCart, ok: true })
      const { $cart, $cartOpen, addToCart } = await getFreshCartModule()

      await assert.doesNotReject(async () => {
        await addToCart('item_private_mode', 1)
      })

      // The cart still works for this page even though it can't be saved
      assert.deepEqual($cart.get(), createdCart)
      assert.equal($cartOpen.get(), true)
      assert.equal(Object.keys(storageStore).length, 0)
    })
  })
})
