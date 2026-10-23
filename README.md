# Shopnex new

## Phase 1

/apps

- /docs # documentation (Fumadocs on Next.js) on :3400 — `pnpm dev:docs`; pages in `apps/docs/content/docs`

- /admin-ui # TanStack Start + shadcn on :3000 — admin (`/admin`), API (`/api/*`), hosted checkout (`/checkout/*`); `/` → `/admin`

- /landing # marketing site (Astro + Tailwind, static) on :3300 — `pnpm dev:landing`; links and copy in `src/site.ts`

- /marketplace # App Marketplace (Next.js on :3200, own database): vendors list apps, Shopnex instances connect and sync

/packages

- /marketplace-sdk # Marketplace API contract (oRPC) + typed client; session-token sign/verify for embedded apps
- /app-bridge # browser library for embedded apps: session tokens, toasts, top-level redirects (postMessage to the admin)
- /storefront-sdk # public Storefront API contract (oRPC, contract-first) + typed client — for any storefront

/templates

- /app-starter # minimal embedded marketplace app (Hono): OAuth install, marketplace verify, app bridge, Admin API, webhooks
- /storefront # the Shopnex storefront (Astro): renders the shop's live theme (Liquid themes in themes/; Storeplate first), editable under Online store → Themes

/modules

- /api # Hono app + oRPC router (mounted by admin-ui at /api; can run standalone later)
- /catalog # products (slugs, images), collections, options → values → variants (price/SKU/stock live on variants)
- /customers # shop-scoped customers, guests matched by email (customerService)
- /cart # server-side carts (token, live prices) + checkout → order (one transaction, idempotent)
- /orders # orders + line items with price snapshots, status transitions (orderService) → uses catalog, customers
- /tenancy # TENANCY_MODE, default shop, resolving the current shop (storefront host / admin active shop)
- /auth # Better Auth integration
- /db # drizzle client + all table schemas (src/schema/<domain>.ts) + migrations
- /theme # themes + component definitions
- /apps # installable apps: custom apps, OAuth authorization codes, installations (each backed by an API token); marketplace connection + catalog sync
- /webhooks # outbound webhooks: endpoints, `emit()` (outbox, same transaction as the change), delivery worker

Domain modules (catalog, customers, orders): business logic only — no HTTP/oRPC/Hono imports;
every service takes `shopId` first and an optional `conn` (db or transaction). Dependencies only point
one way (orders → catalog, customers); domain errors (e.g. `OrderError`) are mapped to 400s in `modules/api`.

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

## Storefront API (for external storefronts)

```ts
import { createStorefrontClient } from '@shopnex/storefront-sdk'

const shopnex = createStorefrontClient({
  baseUrl: 'http://localhost:3000',
  publishableKey: 'pk_…', // admin: POST /api/v1/admin/storefront-keys
})
const shop = await shopnex.shop.get() // { name, handle, currencyCode }
const { nodes, pageInfo } = await shopnex.products.list({
  first: 20,
  collection: 'summer',
  sortKey: 'PRICE',
})
const next = await shopnex.products.list({
  first: 20,
  after: pageInfo.endCursor!,
})
const product = await shopnex.products.getByHandle({
  handle: 'pocket-chronometer',
})
// product.priceRange.minVariantPrice → { amountMinor: 1250000, currencyCode: 'USD' }

// Cart → hosted checkout (prices are live until the order is placed)
const cart = await shopnex.cart.create({
  lines: [{ merchandiseId: product.variants[0].id, quantity: 1 }],
})
location.href = cart.checkoutUrl // or shopnex.checkout.complete({ cartId: cart.id, email }) for headless
```

- Contract v1 (`packages/storefront-sdk/src/contract.ts`, SDK 1.0.0) is aligned with Shopify's Storefront API 2026-10 — see the SDK's CHANGELOG for the mapping and deliberate differences. The server implements it in `modules/api/src/routers/storefront`; only contract fields are returned. Additive changes only from here.
- Checkout: `checkout.options({ cartId })` lists shipping rates (priced for the cart) and payment methods; `checkout.complete` takes contact, `shippingAddress`, `shippingRateId`, `paymentMethodId` and returns `orderNumber`. Orders follow Shopify's model: `financialStatus` + `fulfillmentStatus` + `cancelledAt`, shipping lines, transactions, fulfillments.
- Discounts and taxes: `cart.discountCodesUpdate({ cartId, discountCodes: ['SUMMER20'] })` (one code for now; unknown codes come back with `applicable: false`, as in Shopify). Carts expose `discountCodes`, `discountAllocations` and a discounted `cost.totalAmount`. `checkout.options({ cartId, shippingRateId?, countryCode?, province? })` also returns `cost` (subtotal, shipping, discount, `totalTaxAmount`, `taxesIncluded`, total) for that rate and address. `checkout.complete` refuses a code that doesn't apply (`DISCOUNT_NOT_APPLICABLE`).
- Errors are typed in the contract (`OUT_OF_STOCK { merchandiseId, available }`, `MERCHANDISE_NOT_FOUND`, `LINE_NOT_FOUND`, `CART_COMPLETED`, …).
- Only `active` products are visible to storefronts (`draft` / `archived` are admin-only).
- Shop resolution: `x-shopnex-key` header → that key's shop (invalid/revoked → 401); otherwise default shop (single) or request host (multi).
- Publishable keys are public (safe in browser code); manage them via `admin.storefrontKeys` (owner/admin/super admin).

## API tokens (apps and integrations)

Settings → API tokens (owners/admins): create a secret token (`sk_…`, shown once, stored as a SHA-256 hash) with
per-resource access, then call the Admin REST API with `Authorization: Bearer sk_…`.

- Scopes: `read_products|write_products` (products, variants, collections), `read_orders|write_orders`,
  `read_customers|write_customers`, `read_discounts|write_discounts`; write includes read. `GET /admin/shop` works with any token
- Never reachable with a token: shop settings, staff, storefront keys, API tokens, shipping/payment/tax settings
- Routes opt in with `scoped('read_orders')` / `adminOrToken` (`modules/api/src/orpc.ts`); `admin` / `shopManager` stay session-only
- Webhooks: a token manages only the subscriptions it created, for topics it can read (`order.*` needs `read_orders`).
  Revoking the token deletes them

## Apps

Admin → Apps. Super admins register apps (name, app URL, the most scopes it may get, optional redirect URLs) and get
a `client_id` + a **private key** (`snxk_…`, shown once, never stored: Shopnex keeps only the Ed25519 public half).
No secret is ever shared: the instance signs with its own key, the app with its own.

- **Instance keys**: each instance has an Ed25519 signing key (created on first use, `instance_keys`), published at
  `GET /api/v1/oauth/jwks`. It signs session tokens, access tokens, payments requests and a `v1a` signature on every
  webhook delivery (next to the endpoint's HMAC `v1`, with `shopnex-instance` / `shopnex-key-id` headers)
- **Client assertions**: the app proves who it is with a 60-second JWT signed by its key, addressed to the server it
  calls (RFC 7523: `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`). An instance only
  ever sees assertions for itself, so it can't reuse them against another instance or the marketplace
- **Managed install** (no redirect URLs): Install opens the consent screen (`/admin/oauth/authorize?client_id=…`), approving
  creates the installation and opens the app inside the admin. The app gets tokens from `POST /api/v1/oauth/token`:
  - `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token` = a session token → 1-hour token
  - `grant_type=client_credentials`, `shop_id` → 1-hour token for its installation there (background work)
    Access tokens are JWTs checked against the installation on every request: uninstalling revokes them at once
- **OAuth** (apps with redirect URLs): `/admin/oauth/authorize?client_id=…&redirect_uri=…&scope=…&state=…` → approve →
  `redirect_uri?code=…&state=…&shop_id=…&instance=…`; `grant_type=authorization_code` with `code`, `redirect_uri` and a
  client assertion → a long-lived `sk_…` token. Codes are single-use and expire in 10 minutes
- **App data**: `GET|PUT|DELETE /api/v1/admin/app-data/{key}` (+ `GET /admin/app-data`), an app's own JSON per shop
  (64 KB a value, 100 keys), reachable only with its own token. Kept across reinstall, deleted with the app

Either way the installation is backed by an ordinary API token with the approved scopes (it can manage its own
webhooks); approving again updates the scopes. Uninstalling revokes it and deletes its webhooks; deleting an app
uninstalls it everywhere. App tokens don't appear under Settings → API tokens. `pnpm app:keygen` prints a key pair.

### @shopnex/app

The SDK that makes an app a few routes and no database (`packages/app`, see `templates/app-starter` and `apps/stripe`):

```tsx
const shopnex = createShopnexApp() // SHOPNEX_CLIENT_ID, SHOPNEX_APP_KEY; scopes are the app's registration
const app = new Hono()
app.route('/', shopnex.routes) // /shopnex/app.js + app-bridge.js for the UI components

app.get('/api/stats', async (c) => {
  const { shop, admin, data } = await shopnex.authenticate(c) // session token → cached 1-hour token
  return c.json({ shop: shop.name, orders: await admin.get('/orders?limit=1') })
})

app.get('/', async (c) => {
  await shopnex.authenticate(c)
  return c.html(
    <Page title="My App">
      <Card>
        <Button action="/api/refresh" reload>
          Refresh
        </Button>
      </Card>
    </Page>,
  )
})
```

- `authenticate(c)`: session token (bearer from the app bridge, or `?session_token=` on the embedded load) → `{ shop, userId,
admin, data, payments }`; sets `frame-ancestors`. `forShop(instance, shopId)` for background work
- `verifyPaymentsRequest(c, 'payment' | 'refund')`, `verifyWebhook(c)`: checked against the instance's published keys
- `data.get/set/delete`, `data.getSecret/setSecret` (AES-GCM with a key derived from the app key, unreadable in Shopnex's database)
- `@shopnex/app/ui`: `Page`, `Card`, `Stack`, `Inline`, `Text`, `Badge`, `Banner`, `Stat`, `Button`, `Form`, `TextField`,
  `Select`, `Checkbox`, `Code` (hono/jsx, admin styles, light/dark). `<Form action>` / `<Button action>` call the app's
  backend with fresh session tokens; no client build
- Marketplace apps set `SHOPNEX_MARKETPLACE_URL`: installs are confirmed with the marketplace (cached an hour)

## App Marketplace

A separate hosted service; self-hosted Shopnex installs connect to it.

```
Vendor ──▶ Marketplace (:3200)  ◀── catalog sync / install reports ──  Shopnex instance (:3000)
             ▲                                                            ▲
             └──── app verifies installs ──── App ── OAuth + Admin API ───┘
```

- **Vendors** sign up at the marketplace, create an app (App URL, max access, optional redirect URLs) → client ID + private
  key (the marketplace and instances only keep the public key), publish it
- **Instance** (Admin → Apps → Marketplace, super admins): connect once. The marketplace verifies the instance's public URL
  by fetching `GET {url}/api/v1/marketplace/challenge`, then issues an instance key. The catalog syncs every 10 minutes
  (and on "Sync now") into the local `apps` table (`source = 'marketplace'`); apps gone from it are delisted (no new installs)
- **Install**: App Store → Install opens the consent screen for managed apps; apps with redirect URLs get
  `{appUrl}?shop_id=…&instance=…` and start OAuth (see Apps above)
- **Trust**: anyone can run a Shopnex instance, so apps confirm installs with the marketplace:
  `POST {marketplace}/api/v1/installations/verify` (client assertion for the marketplace, `instance_url`, `shop_id`;
  `@shopnex/app` does it). Instances report installs on install and uninstall, and send the full list on every sync
- Custom apps (Admin → Apps → Custom apps) stay for private integrations that never touch the marketplace

### Embedded apps

"Open" in Admin → Apps loads the app inside the admin (`/admin/apps/{installation}`): an iframe of its App URL with
`shop_id`, `instance`, `embedded=1` and a `session_token`.

- Session token: JWT (EdDSA, 60s) with `iss` (instance origin), `aud` (client_id), `sub` (staff user), `shop_id`, `sid`
  (installation), signed with the instance's key. Verify with `verifySessionToken(token, { clientId, keys:
createJwksResolver() })` from `@shopnex/marketplace-sdk`, or just `shopnex.authenticate(c)`
- The app's frontend uses `@shopnex/app-bridge`: `getSessionToken()` / `authenticatedFetch()` (fresh token per request,
  no third-party cookies), `toast()`, `redirect()` (top-level, only to the admin or the app's own origin: the consent
  screen can't be framed). The admin only answers its own iframe on the app's origin
- Apps should send `Content-Security-Policy: frame-ancestors {instance}` (`authenticate` does); OAuth apps redirect the
  merchant to `{instance}/admin/apps/{installation_id}` afterwards to land inside the admin

```sh
createdb shopnex_marketplace && pnpm marketplace:db:migrate   # once (MARKETPLACE_* in .env)
pnpm dev:marketplace                                          # :3200
cd templates/app-starter && cp .env.example .env && pnpm dev  # :4500, fill SHOPNEX_CLIENT_ID/APP_KEY from the dashboard
```

## Webhooks

Settings → Webhooks (owners/admins): add a URL, pick events, send a test, see deliveries and redeliver.

- Topics: `order.created|paid|fulfilled|cancelled`, `product.created|updated`, `customer.created|updated` (`webhook.test` from the admin)
- Body: `{ type, timestamp, shopId, data }`; `data` is the resource as the admin API returns it, snapshotted when the event happened
- Signed per [Standard Webhooks](https://www.standardwebhooks.com): `webhook-id` (same on retries — dedupe on it), `webhook-timestamp`, `webhook-signature`; verify with any of its libraries and the endpoint's `whsec_…` secret
- Outbox: services call `emit(tx, …)` inside their transaction, so a rolled-back change sends nothing
- Worker: started by `apps/admin-ui/src/server.ts`, polls every 3s, claims rows with `SKIP LOCKED` (safe with several instances). Non-2xx/timeout (10s) → retried after 1m, 5m, 30m, 2h, 5h, 8h, 8h, then failed. Finished deliveries are kept 30 days
- Delivery order isn't guaranteed: use `data.updatedAt`. Stock changes from checkout don't emit `product.updated` (see `order.created`)
- Multi-tenant mode blocks endpoints on private/loopback addresses (SSRF); single mode allows them (e.g. n8n on localhost)

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

- Accounts are invitation-only: the setup wizard creates the first one, everyone else needs a pending invitation (`modules/auth/src/sign-up-policy.ts`, covers email and OAuth). Invite links are copied from Admin → Staff and expire after 7 days
- Shops are Better Auth organizations (`shops`, `shop_members`, `shop_invitations`) — `authClient.organization.*` for switching, invites, roles
- API: `storefront` / `admin` middlewares in `modules/api/src/orpc.ts` put `context.shop` on every procedure
- Super admin (platform role `superadmin`, Better Auth admin plugin): can act in every shop without membership, manage users (`/api/auth/admin/*`, `authClient.admin.*`). The account created by the setup wizard is one; to create or promote another (or recover access):
  `pnpm create-super-admin --email you@example.com [--password ...]` (random password printed if omitted)
- Switching single → multi needs no data migration: add rows to `shop_domains` and set `TENANCY_MODE=multi`

## Setup

```sh
pnpm install
cp .env.example .env        # one .env at the repo root
pnpm db:migrate
pnpm dev                    # app :3000 + default storefront template :4321
```

Open http://localhost:3000 — a fresh install redirects to `/admin/setup`: create the owner account (super admin + shop owner),
name the shop and pick its currency. Anyone who reaches a fresh install can claim it, so finish setup right after deploying.
Shop name/currency and storefront keys can be changed later under Settings.

`pnpm dev` (scripts/dev.mjs) starts TanStack admin and a storefront together (`templates/storefront` unless
`STOREFRONT` says otherwise), with prefixed logs; Ctrl+C stops both. The storefront gets `COMMERCE_PROVIDER=shopnex`
and `SHOPNEX_URL` automatically.

```sh
STOREFRONT=<folder> pnpm dev                  # pick a template (folder in templates/)
STOREFRONT=none pnpm dev                      # app only (same as pnpm dev:app)
STOREFRONT_PORT=4400 pnpm dev                 # template port
STRIPE=none pnpm dev                          # skip a bundled app
```

Bundled apps (`apps/<name>` built on `@shopnex/app`, e.g. `apps/stripe`) start with `pnpm dev` when `.env` sets
`<NAME>_APP_URL`, the same value Shopnex registers them from. An app listens on its URL's port unless `PORT` is set.

### Local ports

| Port | Service                                                     |
| ---- | ----------------------------------------------------------- |
| 3000 | admin-ui: admin, API, hosted checkout                       |
| 3200 | marketplace                                                 |
| 3300 | landing                                                     |
| 3400 | docs                                                        |
| 4321 | storefront template                                         |
| 4500 | app-starter (third-party app development)                   |
| 46xx | bundled first-party apps, in order: 4600 stripe, 4601 next… |

Ports are a local-dev convention only. Core knows an app by its URL (`<NAME>_APP_URL`, the App URL); in production
each app gets its own hostname and listens on whatever `PORT` its platform assigns.

Astro templates need Node ≥ 22.22 (`nvm install && nvm use` reads `.nvmrc`); the script checks this up front.
Production: deploy storefronts separately (their own domain, publishable key); admin/API/checkout on the platform domain.

`apps/admin-ui/.env` is a symlink to the root `.env`; Vite loads it for the admin app.

### OAuth (Google / GitHub)

Set `GOOGLE_CLIENT_ID/SECRET` and/or `GITHUB_CLIENT_ID/SECRET` in `.env` — a provider's button appears only when both are set.
Register these callback URLs with the provider:

- Google (console.cloud.google.com → Credentials → OAuth client, "Web application"): `http://localhost:3000/api/auth/callback/google`
- GitHub (Settings → Developer settings → OAuth Apps): `http://localhost:3000/api/auth/callback/github`

### End-to-end tests

```sh
pnpm dev     # the tests call the running app (APP_URL, default http://localhost:3000)
pnpm e2e     # e2e/tests/*.test.ts, node:test via tsx
```

They run against the dev database, using the Storefront API over HTTP and services for staff-only setup.
Everything a test creates goes through `Fixtures` (`e2e/lib.ts`) and is removed afterwards: orders are cancelled
with restock and deleted, and the order counter and shop settings are restored. The shop needs two active, in-stock variants.

Add shadcn components from `apps/admin-ui`: `pnpm dlx shadcn@latest add <component>`.

## Phase 2 — product, not framework

Rule: if a merchant has to touch code, the CLI or `.env` to do something, it's a product bug.
`.env` keeps infrastructure only (database URL, app secret); everything else lives in the admin.

### 1. Sell without a developer

- ✅ first-run setup wizard in the browser (owner account, shop name, currency) — replaces `pnpm create-super-admin` for new installs
- settings module stored in the database (OAuth, SMTP, payment providers); provider keys encrypted at rest with the app secret
- ✅ payments: manual methods (bank transfer, cash on delivery…) with checkout details + payment instructions; staff mark orders as paid
- payments: connect Stripe from the admin — Stripe Checkout (hosted page), webhook marks the order paid
- ✅ shipping: flat rates with optional free-shipping threshold (one zone: every address)
- ✅ admin: create products; orders (#1001 numbers, Unpaid/Unfulfilled/Cancelled views, mark as paid, fulfill with tracking, cancel with restock); settings (shop, storefront URL, shipping, payments, storefront keys)
- ✅ admin: staff (invite by link, roles admin/staff, remove); open sign-up closed
- admin: discounts, shipping, taxes, rest of the pages from v1
- default storefront: the bundled Astro storefront (`templates/storefront`) runs alongside the app out of the box — no separate setup or publishable key needed
- ✅ themes: theme library (Online store → Themes: current theme, change theme, copies with draft/publish), one storefront with several themes (Storeplate first)
- storefront: product search and filters (needs `query`/vendor/tag/price filters on `products.list`)
- ✅ storefront: hosted checkout (contact, shipping address, shipping + payment method) and order confirmation with payment instructions
- storefront: customer login / sign up; order emails (needs SMTP settings)

### 2. Run and update

- Docker image / `docker compose up`, migrations run automatically on boot
- versioned releases with an upgrade path that never requires forking

### 3. Extend

Out-of-process only, no third-party code in the core.

- ✅ domain events (`order.created`, `product.updated`, …) → signed outbound webhooks (Settings → Webhooks)
- ✅ API tokens with scopes (Settings → API tokens); apps subscribe to webhooks with them
- ✅ installable apps: OAuth install/consent screen, Admin → Apps (installed apps; app registry for super admins)
- ✅ app marketplace (free apps): vendor dashboard, public catalog, instance connect + sync, App Store, install verification
- ✅ embedded app UI: apps open inside the admin (iframe), session tokens via @shopnex/app-bridge
- paid apps (Stripe Connect); listing review
- built-in integrations switched on in settings (Stripe, shipping, analytics)
- Zapier / n8n app
- optional: WooCommerce REST API compatibility — only if the integrations merchants ask for work over REST alone (no WordPress plugin required)

### 4. Polish

- theme editor
- email templates
- domains page (add domain, verify DNS) — replaces manual `shop_domains` rows; multi-shop as a super admin toggle
- onboarding checklist on the dashboard
