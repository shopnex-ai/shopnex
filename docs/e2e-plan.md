# End-to-end testing plan

Goal: tests that cover what merchants fear most (losing orders, double charges, broken upgrades) and that anyone can see passing.

## Today

- `e2e/` holds API-level tests (`node:test` via `tsx`) against a running app: auth, staff roles, tenancy isolation, pricing and checkout, payment apps, carrier services, channels, email, notifications, SEO. See [development](./development.md#end-to-end-tests).
- CI runs them in the `e2e` job on Postgres 17: build, migrate, seed the demo catalog, start the app and storefront, `pnpm e2e`. Server logs are printed on failure.
- Not covered yet: the admin UI and the storefront in a real browser, Stripe test mode with a real webhook, upgrades between releases, and any public test report.

## Plan

### 1. Browser smoke

Add Playwright next to the existing suite (`e2e/browser/`), run in the same CI job against the seeded app.

- Fresh install: setup wizard, first login, set the storefront URL, "View store" opens the storefront.
- Shopper checkout: add to cart, discount code, shipping rate, place the order, see it in the admin.
- Traces, video and screenshots on failure, uploaded as a CI artifact. No retries.

### 2. Money path against Stripe test mode

- Checkout with Stripe test keys, webhooks forwarded with the Stripe CLI.
- Success, declined card, 3DS, a webhook delivered twice (idempotent), a webhook arriving late.
- Needs CI secrets, so it runs on `main` and same-repo PRs only. The fake-app payment tests keep covering forks.

### 3. Failure scenarios

- Two buyers for the last item (no oversell).
- Refund and cancellation, tax and shipping rounding, multi-currency.
- Admin UI permissions: a staff role can't reach owner-only screens.

### 4. Upgrade test

Install the previous release image, seed data, upgrade to the current build, run migrations, then a smoke subset. Fail on any lost data.

### 5. Make it visible

- CI status badge and a nightly run on `main` in the README.
- Publish the Playwright HTML report from the latest `main` run (GitHub Pages).
- A "What we test" page in plain language, and a short video of the checkout run.
- Flake policy: quarantine a flaky test within days; no retries hiding failures.
- Optional: an hourly synthetic order against the demo deployment.

## Open decisions

- Keep `node:test` for the API suite and add Playwright beside it (recommended), or move everything to Playwright's runner.
- Stripe test keys as CI secrets for phase 2.
