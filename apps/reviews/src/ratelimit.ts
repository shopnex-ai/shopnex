// A small in-memory rate limit for the public routes (the widget's API and the review link). Fixed windows per
// client and bucket; counts are per process, so with several instances each one counts on its own.
//
// The client is the socket's address, or, behind a proxy, the header named by CLIENT_IP_HEADER
// (x-forwarded-for, cf-connecting-ip…; the same setting ShopNex itself reads). Behind a proxy without that
// header every visitor looks like the proxy and shares one bucket: set it.
import type { Context, MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

const MAX_CLIENTS = 50_000

export function clientIp(c: Context, header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase()) {
  if (header) {
    // x-forwarded-for lists every hop: the proxy we trust appended the client it saw last
    const value = c.req.header(header)?.split(',').at(-1)?.trim()
    if (value) return value
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // not a real socket (tests)
  }
}

export type RateLimitOptions = {
  /** Requests allowed per window and client */
  max: number
  windowMs: number
  /** Separate counters for separate limits */
  bucket: string
  /** What to answer when the limit is hit (default: 429 JSON) */
  onLimit?: (c: Context, retryAfterSeconds: number) => Response | Promise<Response>
  now?: () => number
  clientOf?: (c: Context) => string
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c, next) => {
    const t = now()
    if (hits.size >= MAX_CLIENTS) {
      for (const [key, hit] of hits) if (hit.resetAt <= t) hits.delete(key)
      if (hits.size >= MAX_CLIENTS) hits.clear() // a flood of addresses: forget it all rather than grow
    }
    const key = (options.clientOf ?? clientIp)(c)
    let hit = hits.get(key)
    if (!hit || hit.resetAt <= t) {
      hit = { count: 0, resetAt: t + options.windowMs }
      hits.set(key, hit)
    }
    hit.count++
    const remaining = Math.max(0, options.max - hit.count)
    c.header('ratelimit-limit', String(options.max))
    c.header('ratelimit-remaining', String(remaining))
    if (hit.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((hit.resetAt - t) / 1000))
      c.header('retry-after', String(retryAfter))
      return options.onLimit
        ? options.onLimit(c, retryAfter)
        : c.json({ error: 'Too many requests, try again shortly' }, 429)
    }
    await next()
  }
}
