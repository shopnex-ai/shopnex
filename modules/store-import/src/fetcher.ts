// How the importer reads a store: one request at a time, slowly, and only from public addresses. The address is typed by a
// shop owner (or a visitor of the demo), so this is the server fetching a URL somebody else chose. Every request, and every
// redirect hop, must resolve to a public address; only the standard ports; a body is cut off at a size limit.
import { assertPublicHost } from '@shopnex/webhooks/network'
import { StoreImportError } from './store-import.errors'

export const USER_AGENT = 'ShopNexImport/1.0 (reads the public catalog of a store its owner pasted)'
const MAX_REDIRECTS = 4
const MAX_BODY_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 25_000
// A store that says 429 is asked again this many times, waiting longer each time (never more than MAX_RETRY_WAIT_MS)
const RATE_LIMIT_RETRIES = 3
const MAX_RETRY_WAIT_MS = 15_000

export type FetchResult = { ok: boolean; status: number; url: string; headers: Headers; text: string }

export type FetcherOptions = {
  /** Stops every request when it fires (the import's overall time limit) */
  signal?: AbortSignal
  /**
   * The least time between two requests to the same host, varied by up to 30% either way (stores rate-limit, HTTP 429,
   * quickly). Time the import already spent between requests counts. Default 0.6 s; doubles (up to 4×) after a 429.
   */
  pauseMs?: number
  /** First wait after a 429, doubled each time unless the store says how long (Retry-After): default 2 s */
  retryWaitMs?: number
  /** Tests replace these */
  fetchImpl?: typeof fetch
  checkHost?: (url: URL) => Promise<void>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `https://Shop.Example.com/products/x?y` → `https://shop.example.com`, or null when it is not a public store address */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim()
  if (!value || value.length > 300 || /[\s<>"'\\]/.test(value)) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null
  const tld = host.split('.').pop()!
  if (tld.length < 2 || !/[a-z]/.test(tld)) return null // rejects 127.0.0.1 and other numeric hosts
  return `https://${host}`
}

export function createFetcher(options: FetcherOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const checkHost = options.checkHost ?? assertPublicHost
  const pauseMs = options.pauseMs ?? 600
  const retryWaitMs = options.retryWaitMs ?? 2000
  // A store that says 429 gets slower requests for the rest of the import
  let slowdown = 1
  const lastRequestAt = new Map<string, number>()

  /** Waits out what is left of the gap since the last request to this host; the first request to a host does not wait */
  async function pace(host: string) {
    const gap = pauseMs * slowdown * (0.7 + Math.random() * 0.6)
    const wait = gap - (Date.now() - (lastRequestAt.get(host) ?? -Infinity))
    if (wait > 0) await sleep(wait)
    lastRequestAt.set(host, Date.now())
  }

  async function readBody(res: Response) {
    const reader = res.body?.getReader()
    if (!reader) return ''
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new StoreImportError('STORE_NOT_READABLE', 'The store sent a page that is too large to read.')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  async function request(input: string, accept = '*/*', attempt = 0): Promise<FetchResult> {
    let url = new URL(input)
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new StoreImportError('STORE_NOT_READABLE', 'The store sent us somewhere that is not a web address.')
      }
      if (url.port || url.username || url.password) {
        throw new StoreImportError('STORE_NOT_READABLE', 'The store sent us to an address we do not read.')
      }
      try {
        await checkHost(url)
      } catch {
        throw new StoreImportError('INVALID_STORE_ADDRESS', 'That address does not point to a public store.')
      }
      // Not an even beat: an import is a few dozen requests, and a store sees them as one visitor
      await pace(url.host)
      let res: Response
      try {
        res = await fetchImpl(url, {
          headers: { 'user-agent': USER_AGENT, accept },
          redirect: 'manual',
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (error) {
        if (options.signal?.aborted) throw error
        throw new StoreImportError('STORE_NOT_READABLE', 'The store did not answer in time.')
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (location) {
        await res.body?.cancel()
        if (hop >= MAX_REDIRECTS)
          throw new StoreImportError('STORE_NOT_READABLE', 'The store redirects too many times.')
        url = new URL(location, url)
        continue
      }
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        await res.body?.cancel()
        slowdown = Math.min(slowdown * 2, 4)
        const told = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(told) && told > 0 ? told * 1000 : retryWaitMs * 2 ** attempt
        await sleep(Math.min(wait, MAX_RETRY_WAIT_MS))
        return request(url.href, accept, attempt + 1)
      }
      return { ok: res.ok, status: res.status, url: url.href, headers: res.headers, text: await readBody(res) }
    }
  }

  async function read(url: string, accept: string) {
    const res = await request(url, accept)
    // 429 after the retries, or 403 (Shopify's "Verifying your connection" check): the store is refusing automated reads
    if (res.status === 429 || res.status === 403) {
      throw new StoreImportError(
        'STORE_BLOCKED',
        'This store is limiting automated reads right now. Wait a few minutes and try again, or bring your products in with the CSV import.',
      )
    }
    if (!res.ok) throw new StoreImportError('STORE_NOT_READABLE', `${new URL(url).pathname} answered ${res.status}.`)
    return res.text
  }

  // The same page asked for twice in one import (the home page is read for its language and for its look) is fetched once
  const seen = new Map<string, Promise<string>>()
  function text(url: string, accept = '*/*') {
    const key = `${accept} ${url}`
    let pending = seen.get(key)
    if (!pending) {
      pending = read(url, accept)
      seen.set(key, pending)
      pending.catch(() => seen.delete(key))
    }
    return pending
  }

  async function json(url: string) {
    try {
      return JSON.parse(await text(url, 'application/json')) as any
    } catch (error) {
      if (error instanceof StoreImportError) throw error
      throw new StoreImportError('STORE_NOT_READABLE', `${new URL(url).pathname} did not answer with data.`)
    }
  }

  return { request, text, json }
}

export type Fetcher = ReturnType<typeof createFetcher>
