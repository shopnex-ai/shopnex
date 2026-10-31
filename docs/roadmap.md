# Roadmap

Rule: if a merchant has to touch code, the CLI or `.env` to do something, it's a product bug.
`.env` keeps infrastructure only (database URL, app secret); everything else lives in the admin.

### 1. Sell without a developer

- ✅ first-run setup wizard in the browser (owner account, shop name, currency) — replaces `pnpm create-super-admin` for new installs
- settings module stored in the database (OAuth, SMTP, payment providers); provider keys encrypted at rest with the app secret
- ✅ payments: manual methods (bank transfer, cash on delivery…) with checkout details + payment instructions; staff mark orders as paid
- ✅ payments: connect Stripe from the admin — Stripe Checkout (hosted page), webhook marks the order paid (`apps/stripe`)
- ✅ shipping: flat rates with optional free-shipping threshold (one zone: every address)
- ✅ admin: create products; orders (#1001 numbers, Unpaid/Unfulfilled/Cancelled views, mark as paid, fulfill with tracking, cancel with restock); settings (shop, storefront URL, shipping, payments, storefront keys)
- ✅ admin: staff (invite by link, roles admin/staff, remove); open sign-up closed
- admin: discounts, shipping, taxes, rest of the pages from v1
- default storefront: the bundled Astro storefront (`templates/storefront`) runs alongside the app out of the box — no separate setup or publishable key needed
- ✅ themes: theme library (Online store → Themes: current theme, change theme, copies with draft/publish), one storefront with several themes (Storeplate first)
- storefront: product search and filters (needs `query`/vendor/tag/price filters on `products.list`)
- ✅ storefront: hosted checkout (contact, shipping address, shipping + payment method) and order confirmation with payment instructions
- ✅ storefront: customer accounts: sign in with an emailed code, order history and details (`/account`)
- ✅ order emails: confirmation, shipping, cancellation (needs SMTP settings in Settings → Email)

### 2. Run and update

- ✅ Docker image runs the admin, storefront and migrations on boot; each bundled app (Stripe…) is its own small Alpine image (`Dockerfile.app`); `docker-compose.yml` runs them together
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
- ✅ domains page (add domain, verify with a DNS TXT record) — replaces manual `shop_domains` rows
- multi-shop as a super admin toggle
- onboarding checklist on the dashboard

### 5. Trust

Tests merchants can see, not only run. Details in [e2e-plan](./e2e-plan.md).

- ✅ API-level e2e suite in CI (auth, staff, tenancy, pricing, payment apps, carrier services, channels, email)
- browser e2e (Playwright): fresh install, storefront checkout, admin flows; traces and video on failure
- checkout against Stripe test mode with real webhooks (declines, 3DS, duplicate and late deliveries)
- failure scenarios: last-item race, refunds, rounding, staff permissions in the UI
- upgrade test: previous release → current build keeps all data
- public test report, CI badge, "What we test" page, nightly run on `main`
