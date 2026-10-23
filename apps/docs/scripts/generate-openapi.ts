// Writes the API spec (public/openapi.json) and the Scalar page that renders it (public/reference) at
// build time, straight from the router, so the docs build needs no running Shopnex instance or database.
import { mkdir, writeFile } from 'node:fs/promises'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { router } from '@shopnex/api/router'
import { PUBLISHABLE_KEY_HEADER } from '@shopnex/storefront-sdk'

const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })

const spec = await generator.generate(router, {
  info: {
    title: 'Shopnex API',
    version: '1.0.0',
    description: [
      '**Storefront** endpoints are public. Send your publishable key (`pk_…`, created in the admin) in the',
      `\`${PUBLISHABLE_KEY_HEADER}\` header; it is optional in single-tenant mode or on the shop's own domain.`,
      '',
      '**Admin** endpoints use the admin session cookie, or an API token (`Authorization: Bearer sk_…`, Settings → API tokens).',
      'A token only reaches products, collections, orders, customers, the shop and its own webhooks, as its scopes',
      'allow (`read_*` / `write_*`; write includes read). Settings, staff, keys and tokens stay staff-only.',
    ].join('\n'),
  },
  servers: [{ url: `${process.env.SHOPNEX_URL ?? 'https://your-shop.example.com'}/api/v1` }],
  components: {
    securitySchemes: {
      publishableKey: { type: 'apiKey', in: 'header', name: PUBLISHABLE_KEY_HEADER },
      apiToken: { type: 'http', scheme: 'bearer', description: 'Admin API token (sk_…)' },
    },
  },
})

await mkdir('public', { recursive: true })
await writeFile('public/openapi.json', JSON.stringify(spec))
console.log(`Wrote public/openapi.json (${Object.keys(spec.paths ?? {}).length} paths)`)

// Same pinned Scalar build and privacy settings as the API's own /api/v1/docs page
const SCALAR_SCRIPT = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.0/dist/browser/standalone.js'
const SCALAR_INTEGRITY = 'sha384-OKyMdsDX84ypSZEhVun8YElXk5c2GQaH3EXPOc6ItmVcLDUAvKHYwvDLvAgsqVtB'
const scalarConfig = {
  url: '/openapi.json',
  proxyUrl: '',
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: 'never',
}

await mkdir('public/reference', { recursive: true })
await writeFile(
  'public/reference/index.html',
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shopnex API reference</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR_SCRIPT}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>
    <script>Scalar.createApiReference('#app', ${JSON.stringify(scalarConfig)})</script>
  </body>
</html>
`,
)
