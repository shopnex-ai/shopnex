// Records which host each request came in on, for core/shopnex (multi-tenant: the host picks the shop).
// The host is the Host header the proxy passes on (Caddy keeps the buyer's), never a client-set x-forwarded-host.
import { defineMiddleware } from 'astro:middleware'
import { requestContext } from './core/shopnex'

// Multi-tenant: the admin's own host (APP_URL) has no shop, so its front page would be a dead end. Send it to the admin,
// which is where a visitor there is headed (sign in, or create a shop). Single shop: the storefront owns "/".
const adminHost = (() => {
  if (process.env.TENANCY_MODE !== 'multi' || !process.env.APP_URL) return null
  try {
    return new URL(process.env.APP_URL).host.toLowerCase()
  } catch {
    return null
  }
})()

export const onRequest = defineMiddleware((context, next) => {
  const host = (context.request.headers.get('host') ?? context.url.host).toLowerCase()
  if (adminHost && host === adminHost && context.url.pathname === '/') return context.redirect('/admin', 302)
  const forwarded = context.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwarded === 'http' || forwarded === 'https' ? forwarded : context.url.protocol.slice(0, -1)
  return requestContext.run({ host, origin: `${protocol}://${host}` }, next)
})
