# Roadmap

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
