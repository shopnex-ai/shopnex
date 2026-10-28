# Apps, API tokens and the marketplace

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

An optional [order inquiry example](../templates/order-inquiry/README.md) checks a quoted order reference
before reading an order through the authenticated SDK. It keeps existing order numbers and uses only
`read_orders`; its README compares the extra code with native lookup and documents the experiment's limits.

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
