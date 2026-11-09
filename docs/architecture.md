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
- /mcp # MCP server (stdio): lets Claude, Cursor and other MCP clients run a store through the Admin API with a scoped token; read-only mode, drafts first, `confirm` before anything goes live

/templates

- /app-starter # minimal embedded marketplace app (Hono): OAuth install, marketplace verify, app bridge, Admin API, webhooks
- /storefront # the ShopNex storefront (Astro): renders the shop's live theme (Liquid themes in themes/; Storeplate first), editable under Online store → Themes

/modules

- /api # Hono app + oRPC router (mounted by admin-ui at /api; can run standalone later)
- /catalog # products (slugs, images), collections, options → values → variants (price/SKU/stock live on variants)
- /custom-fields # shop-defined fields on products, orders and customers: definitions, value validation (customFieldService)
- /customers # shop-scoped customers, guests matched by email (customerService)
- /cart # server-side carts (token, live prices) + checkout → order (one transaction, idempotent)
- /orders # orders + line items with price snapshots, status transitions (orderService) → uses catalog, customers
- /tenancy # TENANCY_MODE, default shop, resolving the current shop (storefront host / admin active shop)
- /auth # Better Auth integration
- /db # drizzle client + all table schemas (src/schema/<domain>.ts) + migrations
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
channels  → db
pricing   → db
drafts    → db
webhooks  → db
theme     → db, drafts
tenancy   → db, channels
auth      → db, tenancy
files     → db, tenancy, webhooks
email     → db, tenancy, webhooks
custom-fields → db
catalog   → db, channels, custom-fields, webhooks
content   → db, catalog
customers → db, auth, custom-fields, email, webhooks   (sign-in codes link a login to the customer)
orders    → db, catalog, channels, custom-fields, customers, email, pricing, webhooks
payments  → db, apps, orders, email, webhooks
cart      → db, apps, catalog, channels, orders, payments, pricing
apps      → db, tenancy
ai        → db, apps, catalog, tenancy
api       → everything above (transport only)
```

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

- Accounts are invitation-only unless `OPEN_SIGNUP=true` (multi mode only): then `/admin/signup` creates an account plus its own shop (owner, a main menu, the Online Store channel, sample products published on it; the first theme appears on first use), and an account without a shop (e.g. OAuth sign-up) is asked to create one. Provisioning lives in `modules/tenancy/src/provisioning.ts`. Otherwise: the setup wizard creates the first one, everyone else needs a pending invitation (`modules/auth/src/sign-up-policy.ts`, covers email and OAuth). Invite links are copied from Admin → Staff and expire after 7 days
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
