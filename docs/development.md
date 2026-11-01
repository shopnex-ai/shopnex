# Development

## Setup

```sh
pnpm install
cp .env.example .env        # one .env at the repo root
pnpm db:migrate
pnpm dev                    # app :3000 + default storefront template :4321
```

Open http://localhost:3000 — a fresh install redirects to `/admin/setup`: create the owner account (super admin + shop owner) with an email and password.
Anyone who reaches a fresh install can claim it, so finish setup right after deploying.
Shop name (`DEFAULT_SHOP_NAME`, default "My Shop"), currency (USD) and storefront keys are set under Settings.

`pnpm dev` (scripts/dev.mjs) starts TanStack admin and a storefront together (`templates/storefront` unless
`STOREFRONT` says otherwise), with prefixed logs; Ctrl+C stops both. The admin uses that storefront's address as the Storefront URL until you save one under Settings (`STOREFRONT_URL` does the same in production, single-shop installs only). The storefront gets `COMMERCE_PROVIDER=shopnex`
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
pnpm --filter @shopnex/e2e test:browser   # e2e/browser/*.spec.ts, Playwright (needs `playwright install chromium` once)
```

They run against the dev database, using the Storefront API over HTTP and services for staff-only setup.
Everything a test creates goes through `Fixtures` (`e2e/lib.ts`) and is removed afterwards: orders are cancelled
with restock and deleted, and the order counter and shop settings are restored. The shop needs two active, in-stock variants.

Add shadcn components from `apps/admin-ui`: `pnpm dlx shadcn@latest add <component>`.

### Demo data

```sh
pnpm demo:orders             # add ~90 days of sample orders and customers to the default shop
pnpm demo:orders --replace   # remove the earlier sample data first
```

Fills the dashboard analytics with a rising sales trend, returning customers, unpaid, cancelled and discounted
orders. Sample customers use `@demo.shopnex.test` addresses, which is how `--replace` finds them. Orders are inserted
directly, so stock, webhooks and emails are untouched. `pnpm demo:seed` (public demo database) runs it as its last step.
