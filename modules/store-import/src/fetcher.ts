// How the importer reads a store: one request at a time, slowly, and only from public addresses. The address is typed by a
// shop owner (or a visitor of the demo), so this is the server fetching a URL somebody else chose. Every request, and every
// redirect hop, must resolve to a public address; only the standard ports; a body is cut off at a size limit.
import { assertPublicHost } from '@shopnex/webhooks/network'
import { StoreImportError } from './store-import.errors'

export const USER_AGENT = 'ShopNexImport/1.0 (reads the public catalog of a store its owner pasted)'
const MAX_REDIRECTS = 4
const MAX_BODY_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 25_000

export type FetchResult = { ok: boolean; status: number; url: string; headers: Headers; text: string }

export type FetcherOptions = {
  /** Stops every request when it fires (the import's overall time limit) */
  signal?: AbortSignal
  /** Pause before each request: stores rate-limit (HTTP 429) quickly */
  pauseMs?: number
  /** Tests replace these two */
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
  const pauseMs = options.pauseMs ?? 300

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

  async function request(input: string, accept = '*/*', retried = false): Promise<FetchResult> {
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
      await sleep(pauseMs)
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
      if (res.status === 429 && !retried) {
        await res.body?.cancel()
        await sleep(2000)
        return request(url.href, accept, true)
      }
      return { ok: res.ok, status: res.status, url: url.href, headers: res.headers, text: await readBody(res) }
    }
  }

  async function text(url: string, accept = '*/*') {
    const res = await request(url, accept)
    if (!res.ok) throw new StoreImportError('STORE_NOT_READABLE', `${new URL(url).pathname} answered ${res.status}.`)
    return res.text
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
