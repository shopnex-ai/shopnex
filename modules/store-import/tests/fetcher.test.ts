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
        return String(url).startsWith('https://a.example.com')
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
        String(url).includes('example.com')
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

  test('a store that says 429 is asked once more, then read', async () => {
    let calls = 0
    const fetcher = createFetcher({
      pauseMs: 0,
      checkHost: async () => {},
      fetchImpl: async () => (++calls === 1 ? new Response('slow down', { status: 429 }) : ok('fine')),
    })
    assert.equal(await fetcher.text('https://shop.example.com/'), 'fine')
    assert.equal(calls, 2)
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
