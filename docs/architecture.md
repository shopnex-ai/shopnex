# Architecture

## Repository layout

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
- Switching single → multi needs no data migration: add each shop's domains in Admin → Settings → Domains and set `TENANCY_MODE=multi`
- Domains are claimed, then verified with a DNS TXT record (`_shopnex-challenge.<domain>`); only verified domains resolve to a shop. Domains inserted into `shop_domains` by hand need `verified_at` set
