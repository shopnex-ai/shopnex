// The importer fetches an address a stranger typed, so what it refuses matters as much as what it reads.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createFetcher, normalizeOrigin } from '../src/fetcher'
import { StoreImportError } from '../src/store-import.errors'

const ok = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init })
const is = (code: string) => (e: unknown) => e instanceof StoreImportError && e.code === code

describe('normalizeOrigin', () => {
  test('a store address in any form becomes its https origin', () => {
    assert.equal(normalizeOrigin('shop.example.com'), 'https://shop.example.com')
    assert.equal(normalizeOrigin('  HTTPS://Shop.Example.com/products/x?y=1#z '), 'https://shop.example.com')
    assert.equal(normalizeOrigin('http://www.shop.example.com/'), 'https://www.shop.example.com')
  })

  test('anything that is not a public store address is refused', () => {
    for (const bad of [
      '',
      'localhost',
      '127.0.0.1',
      'http://10.0.0.5',
      '169.254.169.254',
      '[::1]',
      'shop.example.com:8080',
      'user:pass@shop.example.com',
      'ftp://shop.example.com',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'shop example.com',
      'shop.example.com/<script>',
      `${'a'.repeat(300)}.com`,
      'shop.123',
    ]) {
      assert.equal(normalizeOrigin(bad), null, bad)
    }
  })
})

describe('createFetcher', () => {
  test('reads a page and follows a redirect to another public host', async () => {
    const seen: string[] = []
    const fetcher = createFetcher({
      pauseMs: 0,
      checkHost: async () => {},
      fetchImpl: async (url) => {
        seen.push(String(url))
        return new URL(String(url)).hostname === 'a.example.com'
          ? new Response(null, { status: 301, headers: { location: 'https://www.a.example.com/x' } })
          : ok('hello')
      },
    })
    assert.equal(await fetcher.text('https://a.example.com/'), 'hello')
    assert.deepEqual(seen, ['https://a.example.com/', 'https://www.a.example.com/x'])
  })

  test('a redirect to a private address is refused, whatever the first host was', async () => {
    const fetcher = createFetcher({
      pauseMs: 0,
      fetchImpl: async (url) =>
        new URL(String(url)).hostname.endsWith('.example.com')
          ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
          : ok('secret'),
      // The real guard, on literal addresses (no DNS involved); the first host is passed as public
      checkHost: async (url) => {
        if (url.hostname === 'shop.example.com') return
        const { assertPublicHost } = await import('@shopnex/webhooks/network')
        return assertPublicHost(url)
      },
    })
    await assert.rejects(fetcher.text('https://shop.example.com/'), is('INVALID_STORE_ADDRESS'))
  })

  test('a redirect to a port or with credentials is refused', async () => {
    for (const location of ['https://shop.example.com:8443/', 'https://user:pw@shop.example.com/']) {
      const fetcher = createFetcher({
        pauseMs: 0,
        checkHost: async () => {},
        fetchImpl: async (url) =>
          String(url) === 'https://shop.example.com/'
            ? new Response(null, { status: 302, headers: { location } })
            : ok('x'),
      })
      await assert.rejects(fetcher.text('https://shop.example.com/'), is('STORE_NOT_READABLE'), location)
    }
  })

  test('a redirect loop stops', async () => {
    const fetcher = createFetcher({
      pauseMs: 0,
      checkHost: async () => {},
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: 'https://shop.example.com/again' } }),
    })
    await assert.rejects(fetcher.text('https://shop.example.com/'), is('STORE_NOT_READABLE'))
  })

  test('a body over the size limit is cut off', async () => {
    const big = new Uint8Array(9 * 1024 * 1024)
    const fetcher = createFetcher({
      pauseMs: 0,
      checkHost: async () => {},
      fetchImpl: async () => ok(big as unknown as string),
    })
    await assert.rejects(fetcher.text('https://shop.example.com/'), is('STORE_NOT_READABLE'))
  })

  test('a store that says 429 is asked again, then read', async () => {
    let calls = 0
    const fetcher = createFetcher({
      pauseMs: 0,
      retryWaitMs: 0,
      checkHost: async () => {},
      fetchImpl: async () => (++calls === 1 ? new Response('slow down', { status: 429 }) : ok('fine')),
    })
    assert.equal(await fetcher.text('https://shop.example.com/'), 'fine')
    assert.equal(calls, 2)
  })

  test('a store that keeps saying 429, or answers 403, is reported as blocking, after waiting between asks', async () => {
    let calls = 0
    const waits: number[] = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0)
      return realSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      const limited = createFetcher({
        pauseMs: 0,
        retryWaitMs: 100,
        checkHost: async () => {},
        fetchImpl: async () => {
          calls++
          return new Response('slow', { status: 429, headers: calls === 1 ? { 'retry-after': '3' } : {} })
        },
      })
      await assert.rejects(limited.text('https://shop.example.com/'), is('STORE_BLOCKED'))
      assert.equal(calls, 4) // the first ask and 3 more
      assert.deepEqual(
        waits.filter((ms) => ms >= 100),
        [3000, 200, 400],
      ) // Retry-After first, then doubling
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    const challenged = createFetcher({
      pauseMs: 0,
      checkHost: async () => {},
      fetchImpl: async () => new Response('Verifying your connection...', { status: 403 }),
    })
    await assert.rejects(challenged.text('https://shop.example.com/'), is('STORE_BLOCKED'))
  })

  test('waits about 0.6 s between requests to a host, not exactly the same each time, and not before the first', async () => {
    const waits: number[] = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0)
      return realSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      const fetcher = createFetcher({ checkHost: async () => {}, fetchImpl: async () => ok('fine') })
      for (let i = 0; i < 12; i++) await fetcher.text(`https://shop.example.com/?page=${i}`)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    const pauses = waits.filter((ms) => ms >= 300)
    assert.equal(pauses.length, 11) // none before the first request
    assert.ok(
      pauses.every((ms) => ms >= 400 && ms <= 800),
      pauses.join(' '),
    )
    assert.ok(new Set(pauses).size > 1)
  })

  test('the same address asked for twice in one import is fetched once', async () => {
    let calls = 0
    const fetcher = createFetcher({
      pauseMs: 0,
      checkHost: async () => {},
      fetchImpl: async () => (++calls, ok('page')),
    })
    await fetcher.text('https://shop.example.com/')
    await fetcher.text('https://shop.example.com/')
    assert.equal(calls, 1)
  })

  test('a store that says 429 gets slower requests afterwards', async () => {
    const waits: number[] = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0)
      return realSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      let calls = 0
      const fetcher = createFetcher({
        pauseMs: 1000,
        retryWaitMs: 0,
        checkHost: async () => {},
        fetchImpl: async () => (++calls === 1 ? new Response('slow', { status: 429 }) : ok('fine')),
      })
      await fetcher.text('https://shop.example.com/a')
      waits.length = 0
      await fetcher.text('https://shop.example.com/b')
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    // 1 s base doubled after the 429: 1.4 s to 2.6 s instead of 0.7 s to 1.3 s
    assert.ok(
      waits.some((ms) => ms >= 1400 && ms <= 2600),
      waits.join(' '),
    )
  })

  test('json says what failed in words for the shop owner', async () => {
    const fetcher = createFetcher({ pauseMs: 0, checkHost: async () => {}, fetchImpl: async () => ok('<html>') })
    await assert.rejects(fetcher.json('https://shop.example.com/products.json'), is('STORE_NOT_READABLE'))
  })

  test('the overall signal stops the next request', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = createFetcher({
      pauseMs: 0,
      signal: controller.signal,
      checkHost: async () => {},
      fetchImpl: async (_url, init) => {
        init?.signal?.throwIfAborted()
        return ok('x')
      },
    })
    await assert.rejects(fetcher.text('https://shop.example.com/'))
  })
})
