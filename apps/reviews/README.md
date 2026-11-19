# Reviews (a bundled app)

Product reviews for ShopNex, built on `@shopnex/app` like `apps/stripe` and `apps/shippo`. It runs next to ShopNex as its
own process.

- After an order is **fulfilled** (`order.fulfilled` webhook) the app waits N days (default 7, set in the app), then
  emails the buyer a private, single-use link, through the shop's own email settings (Settings → Email, by way of
  `POST /email/send`, scope `write_email`). The app has no email server of its own.
- The buyer's review waits for the shop's approval (embedded page: Publish / Hide) and is marked **Verified buyer**.
- A widget (`/widget.js`) shows published reviews on the product page.
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

Docker: `docker compose --profile reviews up` (`deploy/docker-compose.yml`). The image keeps its SQLite file in `/data`.

## Where things live

| What                               | Where                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Reviews and review requests        | `DATA_DIR/reviews.db` (SQLite, scoped by instance and shop)                                    |
| Days to wait, whether email is off | the shop's own app storage in ShopNex                                                          |
| Order webhook                      | made by the app with its own token (`src/webhook.ts`), checked again every time the page opens |

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
