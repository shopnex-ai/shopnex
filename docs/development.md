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
`<NAME>_APP_URL`, the same value ShopNex registers them from. An app listens on its URL's port unless `PORT` is set.

### Local ports

| Port | Service                                   |
| ---- | ----------------------------------------- |
| 3000 | admin-ui: admin, API, hosted checkout     |
| 3200 | marketplace                               |
| 3300 | landing                                   |
| 3400 | docs                                      |
| 4321 | storefront template                       |
| 4500 | app-starter (third-party app development) |
| 4600 | stripe (bundled app)                      |
| 4700 | cj-dropshipping (bundled app)             |
| 4900 | shippo (bundled app)                      |

A new bundled app takes the next free port (5000, 5100…) in its `<NAME>_APP_URL`; an app listens on that URL's port unless `PORT` is set.
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

### Lint

`pnpm lint` (ESLint) and `pnpm format:check` (Prettier) run in CI; `pnpm lint:fix` and `pnpm format` fix what they can.

Most of the repo uses the recommended TypeScript rules. Two lists in `eslint.config.mjs` opt modules into more. A module
joins a list once it passes: add its folder, run `pnpm lint`, and fix what it reports. New code in it then has to keep
passing.

- `strictModules`: the strict, type-aware TypeScript rules (no `any`, no floating or misused promises, no `!`, and so
  on), as errors.
- `connectionBoundModules`: the module never imports the shared `db`. Its functions take a `conn` (the shared handle or
  an open transaction) from the caller, so nothing in it can query outside the transaction it was given. That mistake
  freezes the embedded database (see `modules/db/src/embedded-guard.ts`) and is invisible on PostgreSQL.

Today `modules/drafts` and `modules/custom-fields` are in both lists, and `modules/auth` is in the strict one only (it
builds the Better Auth instance with `db` and its functions are entry points, so the no-`db` rule would only add
parameters).

### Logging

Server code logs through `@shopnex/log` (`modules/log`), a small logger with the shape of [pino](https://getpino.io):

```ts
import { createLogger } from '@shopnex/log'

const log = createLogger('payments')
log.info('payment started')
log.error({ err, sessionId }, 'payment session failed') // the object first, then the message, like pino
const orderLog = log.child({ orderId }) // every entry carries orderId
```

- Always pass the error object (`{ err }`), not just its message: the output keeps the type, message, stack, `code` and
  `cause`. It does not copy the error's other properties, because a database error holds the query parameters there.
- Fields with a key that looks sensitive (`password`, `token`, `secret`, `authorization`, `cookie`, `apiKey`, ...) are
  written as `[Redacted]`. Still, never log request bodies, credentials or customer data you don't need.
- `LOG_LEVEL` (default `info`) and `LOG_FORMAT=json` are described in the environment variables reference.
- `modules/payments` and `modules/email` use it, and ESLint refuses `console.*` there (`noConsoleModules` in
  `eslint.config.mjs`). Other modules still log with `console` and move over one at a time.
- Because the call shape is pino's, moving to pino later means changing the import in `modules/log`, not the call sites.
