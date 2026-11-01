// Records which host each request came in on, for core/shopnex (multi-tenant: the host picks the shop).
// The host is the Host header the proxy passes on (Caddy keeps the buyer's), never a client-set x-forwarded-host.
import { defineMiddleware } from 'astro:middleware'
import { requestContext } from './core/shopnex'

export const onRequest = defineMiddleware((context, next) => {
  const host = (context.request.headers.get('host') ?? context.url.host).toLowerCase()
  const forwarded = context.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwarded === 'http' || forwarded === 'https' ? forwarded : context.url.protocol.slice(0, -1)
  return requestContext.run({ host, origin: `${protocol}://${host}` }, next)
})
