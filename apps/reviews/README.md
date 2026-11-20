# Reviews (a bundled app)

Product reviews for ShopNex, built on `@shopnex/app` like `apps/stripe` and `apps/shippo`. It runs next to ShopNex as its
own process.

- After an order is **fulfilled** (`order.fulfilled` webhook) the app waits N days (default 7, set in the app), then
  emails the buyer a private, single-use link, through the shop's own email settings (Settings → Email, by way of
  `POST /email/send`, scope `write_email`). The app has no email server of its own.
- The buyer's review waits for the shop's approval (embedded page: Publish / Hide / Delete, or auto-publish 4–5 stars or everything) and is marked **Verified buyer**. The shop can reply publicly.
- A widget (`/widget.js`) shows the average, the rating breakdown and published reviews (with replies, paged) on the product page, plus `aggregateRating` markup.
- The public routes are rate limited (below).

Scopes it asks for: `read_orders`, `read_products`, `write_email`. Identity: `REVIEWS_APP_KEY` (a `snxk_…` private key, `node scripts/app-keygen.mjs`).
ShopNex learns its public key from `/.well-known/shopnex-app.json`, so setting `REVIEWS_APP_URL` on ShopNex is all the
registration there is. User docs: `apps/docs/content/docs/apps/reviews.mdx`.

## Run it

From the repo root, with `REVIEWS_APP_URL=http://localhost:5100` and `REVIEWS_APP_KEY=snxk_…` in `.env`:

```sh
pnpm dev                       # starts the admin and every app whose <NAME>_APP_URL is set (REVIEWS=none skips this one)
pnpm --filter @shopnex/reviews test
```

Docker: `docker compose --profile reviews up` (`deploy/docker-compose.yml`). Reviews live in the `app_reviews` schema of the shop's Postgres (`APP_DATABASE_URL`, set in the compose files), so the container needs no volume.

## Where things live

| What                                             | Where                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Reviews and review requests                      | the `app_reviews` schema of the shop's Postgres (`APP_DATABASE_URL`), scoped by instance and shop |
| Days to wait, publish mode, whether email is off | the shop's own app storage in ShopNex                                                             |
| Order webhook                                    | made by the app with its own token (`src/webhook.ts`), checked again every time the page opens    |

## Database

Like CJ Dropshipping, the app keeps its tables in a Postgres schema of its own (`app_reviews`), next to ShopNex's, and applies
its migrations when it starts. It reads `APP_DATABASE_URL`, else `DATABASE_URL` when that is a Postgres URL (so `pnpm dev`
with the shop's `.env` just works). `pglite:<folder>` is the embedded database for trying things out. To change a table, edit
`src/schema.ts` and run `pnpm --filter @shopnex/reviews generate`: it writes the migration into `drizzle/` and needs no database.

## Rate limiting

`src/ratelimit.ts`: fixed windows per client, in memory. `/public/*` allows 120 requests a minute, `/r/*` 20 (see `LIMITS`
in `src/app.tsx`). The client is the socket address, or, with `CLIENT_IP_HEADER` set (the same variable ShopNex reads), the
**last** value of that header, the one the proxy you trust added. Behind a proxy without it everyone shares one bucket.
Counts are per process: run one instance, or move the counters to shared storage.

## Notes and limits

- `data-product="{{ product.id }}"`: the widget and the API accept a bare id or `gid://…/<id>`; check which one your theme prints.
- A request that cannot go out (the shop has email off, its server is down, the app was uninstalled) stays due and is retried every minute. With email off, ShopNex answers `{ sent: false }` and the app asks once per shop per pass.
- Requests are sent from a one-minute timer inside the process; run one instance, or move the timer to a job runner.
- ShopNex only lets an app email people who are customers of the shop, at most 500 an hour per shop (see `modules/email/src/app-email.ts`).
- `hono` comes from the workspace catalog so its types match `@shopnex/app`.
