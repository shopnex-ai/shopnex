# Architecture

## Repository layout

/apps

- /docs # documentation (Fumadocs on Next.js) on :3400 — `pnpm dev:docs`; pages in `apps/docs/content/docs`

- /admin-ui # TanStack Start + shadcn on :3000 — admin (`/admin`), API (`/api/*`), hosted checkout (`/checkout/*`); `/` → `/admin`

- /landing # marketing site (Astro + Tailwind, static) on :3300 — `pnpm dev:landing`; links and copy in `src/site.ts`

- /marketplace # App Marketplace (Next.js on :3200, own database): vendors list apps, ShopNex instances connect and sync

/packages

- /marketplace-sdk # Marketplace API contract (oRPC) + typed client; session-token sign/verify for embedded apps
- /app-bridge # browser library for embedded apps: session tokens, toasts, top-level redirects (postMessage to the admin)
- /storefront-sdk # public Storefront API contract (oRPC, contract-first) + typed client — for any storefront

/templates

- /app-starter # minimal embedded marketplace app (Hono): OAuth install, marketplace verify, app bridge, Admin API, webhooks
- /storefront # the ShopNex storefront (Astro): renders the shop's live theme (Liquid themes in themes/; Storeplate first), editable under Online store → Themes

/modules

- /api # Hono app + oRPC router (mounted by admin-ui at /api; can run standalone later)
- /catalog # products (slugs, images), collections, options → values → variants (price/SKU/stock live on variants)
- /custom-fields # shop-defined fields on products, orders and customers: definitions, value validation (customFieldService). The first module that owns its whole slice: `custom-fields.schema.ts` (tables), `custom-fields.contract.ts` (Zod shapes, safe for the browser), `custom-fields.router.ts` (its Admin API routes, `@shopnex/custom-fields/router`)
- /kit # `defineModule`: the manifest a module declares in `src/<name>.module.ts` (name, `dependsOn`, tables, router). A plain object, no decorators; the routes are mounted by name in `modules/api/src/router.ts`. It also has `defineError`: a module's errors, with the status of each code, answered by `rpc` with nothing to wire. `pnpm modules:check` (also in CI) fails on an import that package.json doesn't list, a manifest that disagrees with package.json, or a cycle, and with `--report` lists what moving tables into modules will have to solve (tables reached across modules, foreign keys against the graph)
- /rpc # the building blocks of a route (who is calling, the shop, scopes) for every module that exposes routes. It answers any error made with `defineError` by itself, so nothing here knows a module. Depends on `db` and `kit` only: how a request is recognised (the session, the admin's shop, an API or app token, scopes) is registered once by `modules/api` (`configureRpc`, with the session type supplied by interface augmentation), so a module that sits below auth or tenancy can have routes too. Its tests use fake resolvers
- /customers # shop-scoped customers, guests matched by email (customerService)
- /cart # server-side carts (token, live prices) + checkout → order (one transaction, idempotent)
- /orders # orders + line items with price snapshots, status transitions (orderService) → uses catalog, customers
- /tenancy # TENANCY_MODE, default shop, resolving the current shop (storefront host / admin active shop)
- /auth # Better Auth integration
- /db # drizzle client + the core table schemas (src/schema/<domain>.ts) + migrations (one history for all tables). A module may own its tables in `modules/<name>/src/<name>.schema.ts` (custom-fields does): `pnpm db:generate` and the privacy test find them by that name, and CI fails when the schema and the migrations disagree
- /theme # themes + component definitions
- /apps # installable apps: custom apps, OAuth authorization codes, installations (each backed by an API token); marketplace connection + catalog sync
- /webhooks # outbound webhooks: endpoints, `emit()` (outbox, same transaction as the change), delivery worker
- /ai # AI capabilities: built-in providers (Claude, OpenAI; Settings → AI), apps that provide capabilities, running one, generations → uses apps, catalog

Domain modules (catalog, customers, orders): business logic only — no HTTP/oRPC/Hono imports;
every service takes `shopId` first and an optional `conn` (db or transaction). Dependencies only point
one way, with no cycles; domain errors (e.g. `OrderError`) are mapped to 400s in `modules/api`. Today's graph
(a module imports only what is on its right):

```text
db        →
channels  → db, rpc   (owns storefront_keys and resource_publications; the channels table stays in db while orders and carts, which point at it, are still there)
pricing   → db, rpc
drafts    → db
webhooks  → db, rpc, tenancy   (owns webhook_endpoints and webhook_deliveries; tenancy tells it when an API token is revoked)
theme     → db, drafts, rpc, storefront-sdk   (the Theme Store catalog is its table; apps fills it through replaceStore)
tenancy   → db, channels, rpc   (owns shop_members, shop_invitations and shop_domains; shops and api_tokens stay in db with the other foundation tables; no connection injection, like auth: its resolvers are request entry points)
auth      → db, tenancy   (owns session, account, verification and rate_limits; the user table stays in db with the other foundation tables)
files     → db, rpc, tenancy, webhooks
email     → db, tenancy, webhooks
rpc       → db   (the route building blocks; knows nothing of logins, tokens or shops: modules/api registers those with `configureRpc`)
custom-fields → db, rpc
catalog   → db, channels, custom-fields, webhooks
content   → db, catalog, tenancy, rpc   (owns pages and menus; listens to shopCreated and seeds a new shop's menus)
customers → db, auth, custom-fields, email, webhooks   (sign-in codes link a login to the customer)
orders    → db, catalog, channels, custom-fields, customers, email, pricing, webhooks
payments  → db, apps, orders, email, webhooks, rpc, marketplace-sdk   (owns payment_methods: the checkout settings and a payments app's own method)
cart      → db, apps, catalog, channels, orders, payments, pricing
apps      → db, tenancy, theme, rpc, marketplace-sdk, storefront-sdk   (owns app_installations, app_authorization_codes, app_data, instance_keys and marketplace_connection; the apps registry table stays in db with the other foundation tables; owns appUninstalled and runs the carrier-service cleanup itself until cart is a module)
ai        → db, apps, catalog, tenancy, rpc, marketplace-sdk   (owns ai_providers, ai_settings, ai_generations; apps tells it when an app is uninstalled)
api       → everything above (transport only)
```

## Writing a module

`modules/custom-fields` is the worked example. A module's own code sits in `modules/<name>/src`, one file per concern,
named `<name>.<concern>.ts`:

| File                 | What it holds                                                                                              | Rules                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `<name>.schema.ts`   | Its tables (Drizzle). `pnpm db:generate` and the privacy test find them by this name.                      | Tables and constants only. `modules:check` fails a table defined in any other file: it would get no migration. |
| `<name>.errors.ts`   | Its errors, with the HTTP status of each code (`defineError`, below).                                      | No HTTP or oRPC imports.                                                                                       |
| `<name>.service.ts`  | Business logic: every function takes `shopId` first and a `conn`.                                          | No HTTP, oRPC or Hono imports; never import the shared `db`.                                                   |
| `<name>.contract.ts` | The Zod shapes of its API: inputs and outputs. The admin UI uses them for its forms.                       | Must stay free of server code: the browser bundles it.                                                         |
| `<name>.router.ts`   | Its Admin API routes (`@shopnex/custom-fields/router`), built with `createProcedures` from `@shopnex/rpc`. | The one place that passes the shared `db` to the service.                                                      |
| `<name>.module.ts`   | The manifest: `name`, `dependsOn`, `tables`, `router`.                                                     | Read by `modules:check`; its router is mounted in `modules/api/src/router.ts`.                                 |

What a module exposes. Other code reaches a module only through the entries in its `package.json` `exports`, never by a
deep path:

| Import                                    | What it gives                                                                           | Where it may run   |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ------------------ |
| `@shopnex/custom-fields` (`src/index.ts`) | The module's public API: the service (`customFieldService`), its error class and types. | Server only        |
| `@shopnex/custom-fields/schema`           | Tables, constants and their types.                                                      | Server and browser |
| `@shopnex/custom-fields/contract`         | The Zod shapes of its API.                                                              | Server and browser |
| `@shopnex/custom-fields/router`           | Its Admin API routes.                                                                   | Server only        |
| `@shopnex/custom-fields/module`           | The manifest.                                                                           | Server only        |

Rules for `index.ts`, the same as Nest's: no barrel files inside a module.

- Inside a module, files import each other by relative path (`./custom-fields.service`), never through `index.ts`, so the
  entry cannot create an import cycle.
- Keep the root entry small: the service, the errors and the types. Do not re-export the router, the manifest or anything
  else that drags in more.
- Code that runs in the browser (the admin UI's forms, `@shopnex/api/schemas`) imports only `/schema` or `/contract`.
  The root entry exports the service, which pulls in the database client, and a browser bundle that reaches it fails with
  `Buffer is not defined`. `pnpm bundle:check` (also in CI) bundles every `@shopnex/...` entry the admin UI's `.tsx` files
  import, and every module's `*.contract.ts` and `*.schema.ts`, for the browser, and fails when server code comes along.

Tests that delete rows run on the embedded database and say so: set `DATABASE_URL=pglite:memory` before anything imports
`@shopnex/db`, then call `requireEmbeddedDatabase()` (it refuses any other database before a row is touched). Routes stand on the
resolvers `modules/api` registers with `configureRpc`; the entry point that mounts them calls `assertRpcConfigured()`, so a
process that forgot to register them fails at startup.

Errors: declare the status next to the code, and that is all: `rpc` answers any error made with `defineError` with the status its
class declares for the code (the code goes in `data`, the error is the cause). No mapper, no manifest field, no registration:

```ts
// custom-fields.errors.ts
export const CustomFieldError = defineError('CustomFieldError', {
  FIELD_NOT_FOUND: 'NOT_FOUND',
  KEY_TAKEN: 'CONFLICT',
  INVALID_VALUE: 'BAD_REQUEST',
})
```

An error that carries more than a code extends the class (`class OrderError extends defineError('OrderError', { ... })` with
its own `readonly data`). The Storefront routes answer with the typed errors of the public contract, so `modules/api/src/orpc.ts`
keeps that mapping (five branches, not status tables). A class can add fields to the response's `data` with the `data`
option of `defineError` (the OAuth errors of apps also name the code as `error`), and a route can pass its own mapper to
`createProcedures` for an error that must answer differently; it is tried first, then the default.
`pnpm modules:check` verifies
the manifest against the imports and `package.json`.

Hooks: when a module has to react to something another module does, and the dependency would run against the graph (`payments`
depends on `apps`, so `apps` cannot call it), the owner declares a hook and runs it inside its own transaction; the module that
cares adds a listener under an id when it loads. The owner never imports the listener, a listener that throws undoes the owner's
transaction, and adding the same id again replaces it (a module loaded twice does not run twice):

```ts
// apps.hooks.ts
export const appUninstalled = defineHook<{ shopId: string; appId: string }, Conn>('app.uninstalled')
// apps.ts, in the uninstall transaction:   await appUninstalled.run(tx, { shopId, appId })
// payments.hooks.ts:                       appUninstalled.on('payments.method', (conn, { shopId, appId }) => …)
// tenancy.hooks.ts / webhooks.hooks.ts:    the same for apiTokenRevoked: a revoked token takes its webhook subscriptions with it
// tenancy.hooks.ts / content.hooks.ts:     shopCreated: a new shop gets its menus (tenancy cannot call content, which reaches tenancy through catalog and webhooks)
```

A listener only runs in a process that loaded its module, so the module's entry points (`index.ts` and `*.module.ts`) import the
file that registers it, and a test that goes through the real route guards it (`modules/api/tests/uninstall-hooks.test.ts`).
Importing only `/schema` or `/contract` registers nothing: code that uninstalls an app or revokes a token without going through the API
(a script, an e2e test calling `appService.uninstall`) has to import the module's entry, or its cleanup is silently skipped.

## API layout

```
/api/auth/*          Better Auth
/api/rpc/*           oRPC (typed client for admin-ui)
/api/v1/*            oRPC OpenAPI/REST (/v1/storefront/*, /v1/admin/*)
/api/v1/openapi.json OpenAPI spec
/api/webhooks/*      plain Hono routes (raw body)
```

- Hono = transport (cors, logging, headers, auth mount, webhooks)
- oRPC = procedures, validation, auth guards (`pub` / `authed` in `modules/api/src/orpc.ts`)
- TanStack server functions call procedures via `apps/admin-ui/src/lib/orpc.server.ts`
- Admin screens use `apps/admin-ui/src/lib/orpc.ts` with TanStack Query

To run the API as a separate service later, create `apps/api` with
`serve({ fetch: app.fetch })` from `@hono/node-server` (and `basePath` stays `/api`).

## Routes (apps/admin-ui)

```
/                  → redirects to /admin (storefronts are separate apps, see templates/)
/admin             src/routes/admin*        protected (redirects to /admin/login)
/admin/login       src/routes/admin.login   sign in
/admin/setup       src/routes/admin.setup   first run only (no users yet)
/admin/invite/{id} src/routes/admin.invite  accept a staff invitation (sign up or sign in)
/checkout/{token}  src/routes/checkout      hosted checkout (any storefront redirects here)
/api/*             src/routes/api.$         Hono
```

## Tenancy

Always multi-tenant underneath (every tenant table has `shop_id`); `TENANCY_MODE` only changes how the shop is resolved.

|            | `single` (default)         | `multi`                                           |
| ---------- | -------------------------- | ------------------------------------------------- |
| Storefront | default shop               | shop from request host (`shop_domains`)           |
| Admin      | default shop               | session's active shop, else the user's first shop |
| New users  | invited from Admin → Staff | invited, or create their own shop                 |

- Accounts are invitation-only unless `OPEN_SIGNUP=true` (multi mode only): then `/admin/signup` creates an account plus its own shop (owner, a main menu, the Online Store channel; the empty Products page offers an "Add sample products" button; the first theme appears on first use), and an account without a shop (e.g. OAuth sign-up) is asked to create one. Provisioning lives in `modules/tenancy/src/provisioning.ts`. Otherwise: the setup wizard creates the first one, everyone else needs a pending invitation (`modules/auth/src/sign-up-policy.ts`, covers email and OAuth). Invite links are copied from Admin → Staff and expire after 7 days
- Shops are Better Auth organizations (`shops`, `shop_members`, `shop_invitations`) — `authClient.organization.*` for switching, invites, roles
- API: `storefront` / `admin` middlewares in `modules/api/src/orpc.ts` put `context.shop` on every procedure
- Super admin (platform role `superadmin`, Better Auth admin plugin): can act in every shop without membership, manage users (`/api/auth/admin/*`, `authClient.admin.*`). The account created by the setup wizard is one; to create or promote another (or recover access):
  `pnpm create-super-admin --email you@example.com [--password ...]` (random password printed if omitted)
- Switching single → multi needs no data migration: add each shop's domains in Admin → Settings → Domains and set `TENANCY_MODE=multi`
- Set `ROOT_DOMAIN` (multi mode) and every shop is also served at `<slug>.ROOT_DOMAIN` with no DNS step; a shop without a saved Storefront URL gets that address (checkout and emails link back to it). Slugs the platform keeps (`admin`, `www`, `api`…, see `modules/tenancy/src/subdomains.ts`) are never assigned, and custom domains can't be under the root. Needs wildcard DNS and TLS for `*.ROOT_DOMAIN`
- The bundled storefront follows the host in multi mode (`TENANCY_MODE=multi`): `templates/storefront/src/middleware.ts` records each request's Host, server-side API calls pass it on as `x-forwarded-host`, and the page's scripts call the storefront's own origin (the proxy sends `/api/*` to the admin app). Behind your own proxy it must pass the buyer's `Host` through and send `/api/*`, `/checkout/*` to the admin app, as `deploy/Caddyfile` does. The Docker image's Caddy serves `*.ROOT_DOMAIN` too when `DOMAIN` and `ROOT_DOMAIN` are set; the wildcard certificate needs the DNS-01 challenge, so put its `tls { dns … }` block in a file and point `SITE_TLS_FILE` at it (or terminate TLS at a CDN)
- Domains are claimed, then verified with a DNS TXT record (`_shopnex-challenge.<domain>`); only verified domains resolve to a shop. Domains inserted into `shop_domains` by hand need `verified_at` set

## AI capabilities

Built in, like email providers: Settings → AI picks Claude or OpenAI with the shop's own key (contract:
`@shopnex/marketplace-sdk/ai`, docs: `apps/docs/content/docs/apps/ai.mdx`). Apps can provide capabilities too; built-in
AI answers first when it's on. Core owns permissions, the commerce context and what gets saved either way.

```text
Admin ✨ Generate → POST /admin/ai/run → modules/ai ─┬→ built-in provider (modules/ai/src/builtin, shop's key)
                    (read_products)                  └→ signed AiRunRequest → an app that provides the capability
                    loads the product, checks the answer against the schema, sanitizes it, records the generation
```

- Built-in providers run in the ShopNex process: settings in `ai_settings`, the key encrypted with
  `@shopnex/db/secrets`, the SDKs imported on first use (ShopNex starts without them), one attempt under a minute

- Capabilities (`product.description`, `product.seo`, `product.image_alt`, `product.classify`, `collection.description`, `collection.seo`, `page.content`) are a typed, versioned registry with zod input/output schemas;
  additive changes only, a breaking change is a new name
- Apps register what they provide per shop with `POST /admin/ai-app/configure` (scope `write_ai_capabilities`,
  URLs on the app's origin) → `ai_providers`. Uninstalling removes them
- `POST /admin/ai/run` returns a suggestion and never writes: the admin puts it in the form as an unsaved change
- Every run is an `ai_generations` row (input, output, usage, status, staff feedback) for audit and quality
