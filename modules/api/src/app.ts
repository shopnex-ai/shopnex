import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { ORPCError, onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { auth } from '@shopnex/auth'
import { readLocalFile, typeOfKey } from '@shopnex/files'
import { PUBLISHABLE_KEY_HEADER } from '@shopnex/storefront-sdk'
import { router } from './router'
import { createContext } from './orpc'

const BASE = '/api'

// Log unexpected errors server-side (expected ones like 401/404 are skipped); clients only see a generic 500
const logError = (error: unknown) => {
  if (error instanceof ORPCError && error.status < 500) return
  console.error('[orpc]', error)
}

const rpcHandler = new RPCHandler(router, { interceptors: [onError(logError)] })
// API reference UI. Pinned + integrity-checked: the page runs on the admin's origin (session cookie),
// so the script must be exactly the file we reviewed. To upgrade: bump the version, recompute the hash
// (curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A).
const SCALAR_SCRIPT = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.0/dist/browser/standalone.js'
const SCALAR_INTEGRITY = 'sha384-OKyMdsDX84ypSZEhVun8YElXk5c2GQaH3EXPOc6ItmVcLDUAvKHYwvDLvAgsqVtB'

// Keep requests and the spec on our side: no proxy.scalar.com relay for "Try it" (its default for
// non-localhost URLs), no telemetry, no hosted AI/MCP/share/deploy features
const scalarPrivacy = {
  proxyUrl: '',
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: 'never',
}

// Behind a TLS-terminating proxy the request URL says http://, which the browser blocks as mixed content
// on an https page; a same-origin path works everywhere
const specPath = (specUrl: string) => {
  const { pathname, search } = new URL(specUrl)
  return pathname + search
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const apiReference = new OpenAPIReferencePlugin({
  schemaConverters: [new ZodToJsonSchemaConverter()],
  specPath: '/openapi.json',
  docsPath: '/docs',
  docsTitle: 'Shopnex API',
  specGenerateOptions: {
    info: {
      title: 'Shopnex API',
      version: '1.0.0',
      description: [
        '**Storefront** endpoints are public. Send your publishable key (`pk_…`, created in the admin) in the',
        `\`${PUBLISHABLE_KEY_HEADER}\` header; it is optional in single-tenant mode or on the shop's own domain.`,
        '',
        '**Admin** endpoints use the admin session cookie: sign in to the admin in this browser to try them here.',
        'Apps and integrations send an API token instead (`Authorization: Bearer sk_…`, Settings → API tokens).',
        'A token only reaches products, collections, orders, customers, the shop and its own webhooks, as its scopes',
        'allow (`read_*` / `write_*`; write includes read). Settings, staff, keys and tokens stay staff-only.',
      ].join('\n'),
    },
    servers: [{ url: `${BASE}/v1` }],
    components: {
      securitySchemes: {
        publishableKey: { type: 'apiKey', in: 'header', name: PUBLISHABLE_KEY_HEADER },
        apiToken: { type: 'http', scheme: 'bearer', description: 'Admin API token (sk_…)' },
      },
    },
  },
  renderDocsHtml: (specUrl, title) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR_SCRIPT}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>
    <script>Scalar.createApiReference('#app', ${JSON.stringify({ url: specPath(specUrl), ...scalarPrivacy })})</script>
  </body>
</html>`,
})

const openapiHandler = new OpenAPIHandler(router, { interceptors: [onError(logError)], plugins: [apiReference] })

export const app = new Hono().basePath(BASE)

// --- transport concerns (Hono) ---
app.use(logger())

// --- uploaded files on the local disk (other storage providers serve their own URLs) ---
// Before secureHeaders, whose same-origin resource policy would keep storefronts on other origins from
// loading them. Keys are random and never reused, so they cache forever.
app.get('/files/:shopId/:name', async (c) => {
  const key = `${c.req.param('shopId')}/${c.req.param('name')}`
  const type = typeOfKey(key)
  const file = type && (await readLocalFile(key))
  if (!file) return c.json({ error: 'Not found' }, 404)
  return c.body(file.body, 200, {
    'Content-Type': type,
    'Content-Length': String(file.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
})

app.use(secureHeaders())
// Public REST API is callable from other origins (storefront, 3rd parties)
app.use('/v1/*', cors())

// --- Better Auth ---
app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))

// --- webhooks: plain Hono routes (raw body available via c.req.text()) ---
// app.post('/webhooks/stripe', async (c) => { ... })

// --- oRPC: typed RPC for the TanStack admin ---
app.use('/rpc/*', async (c, next) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: `${BASE}/rpc`,
    context: createContext(c.req.raw.headers),
  })
  if (matched) return c.newResponse(response.body, response)
  await next()
})

// --- oRPC: OpenAPI/REST for storefront & 3rd parties ---
// Also serves the spec (/v1/openapi.json) and the API reference (/v1/docs)

app.use('/v1/*', async (c, next) => {
  const { matched, response } = await openapiHandler.handle(c.req.raw, {
    prefix: `${BASE}/v1`,
    context: createContext(c.req.raw.headers),
  })
  if (matched) return c.newResponse(response.body, response)
  await next()
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export type App = typeof app
