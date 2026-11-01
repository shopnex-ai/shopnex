// Customer sessions on the storefront server. The token Shopnex returns at sign-in lives in an httpOnly
// cookie; pages send it back with every Storefront API call made for the customer (shopnexFor).
import type { AstroCookies } from 'astro'
import { ORPCError, isDefinedError, safe, type Customer } from '@shopnex/storefront-sdk'
import { shopnexFor } from './shopnex'

const COOKIE = 'shopnex_customer'
// Matches how long Shopnex keeps a customer session (Better Auth's default)
const MAX_AGE_S = 7 * 24 * 60 * 60

export const tokenOf = (cookies: AstroCookies) => cookies.get(COOKIE)?.value

export function startSession(cookies: AstroCookies, url: URL, token: string) {
  cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Behind a TLS-terminating proxy the URL says http; the proxy says what the browser used
    secure: url.protocol === 'https:',
    path: '/',
    maxAge: MAX_AGE_S,
  })
}

export const endSession = (cookies: AstroCookies) => cookies.delete(COOKIE, { path: '/' })

/** The signed-in customer, and a client acting for them; null customer when not signed in or expired */
export async function session(cookies: AstroCookies) {
  const token = tokenOf(cookies)
  const client = shopnexFor(token)
  if (!token) return { client, customer: null as Customer | null }
  const [error, customer] = await safe(client.customer.get())
  if (!error) return { client, customer }
  if (isDefinedError(error) && error.code === 'UNAUTHORIZED') {
    endSession(cookies)
    return { client, customer: null as Customer | null }
  }
  throw error
}

/** Only paths inside the account come back from `?next=` (no open redirects) */
export const safeNext = (value: string | null | undefined) =>
  value && /^\/account(\/[\w\-./]*)?$/.test(value) ? value : '/account'

/** What a failed customer call tells the shopper */
export function messageFor(error: unknown) {
  if (error instanceof ORPCError) {
    if (error.code === 'INVALID_CODE') return 'That code is wrong or has expired. Check it or ask for a new one.'
    if (error.code === 'TOO_MANY_REQUESTS') return 'Too many codes requested. Wait a few minutes and try again.'
    if (error.code === 'CUSTOMER_LOGIN_UNAVAILABLE')
      return 'Signing in is not available right now. Please try again later.'
    if (error.status === 400) return 'Enter a valid email address.'
  }
  return 'Something went wrong. Please try again.'
}
