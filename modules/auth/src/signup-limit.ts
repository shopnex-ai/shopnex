// Rate limits for open sign-up (OPEN_SIGNUP=true), where anyone can create accounts and shops. Two caps per hour:
//   per address  SIGNUP_RATE_PER_IP  (default 5)    one visitor can't create a pile of shops
//   everyone     SIGNUP_RATE_GLOBAL  (default 200)  a flood from many addresses still can't fill the database
// Counted in memory, per process: a restart clears them, and several replicas each keep their own. That is enough to
// slow abuse down, which is all it is for.
//
// The client address comes from CLIENT_IP_HEADER (comma list, first hit wins; default x-forwarded-for). Behind Cloudflare
// set it to cf-connecting-ip: x-forwarded-for there is a chain or the proxy's own address. A header with several
// values (a chain) is never trusted, since the left ones are chosen by the client. Without a usable address only the
// global cap applies. Set it only to a header your own proxy sets: a client can send any header the proxy passes on.

const HOUR_MS = 60 * 60 * 1000
const MAX_BUCKETS = 10_000

const positive = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const signupsPerIp = () => positive(process.env.SIGNUP_RATE_PER_IP, 5)
export const signupsGlobal = () => positive(process.env.SIGNUP_RATE_GLOBAL, 200)

export const clientIpHeaders = () => {
  const names = (process.env.CLIENT_IP_HEADER ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  return names.length ? names : ['x-forwarded-for']
}

/** The visitor's address from the configured header, or null when there is none worth trusting */
export function clientIp(headers: Headers) {
  for (const name of clientIpHeaders()) {
    const value = headers.get(name)?.trim()
    if (value && !value.includes(',') && /^[0-9a-f:.]{2,45}$/i.test(value)) return value.toLowerCase()
  }
  return null
}

const buckets = new Map<string, { count: number; resetAt: number }>()

// One more use of `key`, or the seconds until it frees up when `max` is used already
function take(key: string, max: number, now: number) {
  if (buckets.size > MAX_BUCKETS) for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k)
  let bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + HOUR_MS }
    buckets.set(key, bucket)
  }
  if (bucket.count >= max) return Math.ceil((bucket.resetAt - now) / 1000)
  bucket.count++
  return null
}

export const SIGNUP_LIMIT_MESSAGE = 'Too many sign-ups right now. Please try again later.'

/** Counts one sign-up from this visitor. `retryAfterS` is set when they are over the per-address cap. */
export function checkSignupRate(headers: Headers, now = Date.now()) {
  const ip = clientIp(headers)
  const retryAfterS = ip ? take(`ip:${ip}`, signupsPerIp(), now) : null
  return retryAfterS === null ? { ok: true as const } : { ok: false as const, retryAfterS }
}

/** Counts one new account against the cap for everyone. Null when there is room. */
export const takeGlobalSignup = (now = Date.now()) => take('global', signupsGlobal(), now)

/** For tests */
export const resetSignupLimits = () => {
  buckets.clear()
}
