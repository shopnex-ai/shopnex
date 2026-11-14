# Migration Plan: Paystack + BobGo (built in, API direct)

## 1. Goal

Move this ShopNex fork to a small store stack for South Africa.

| Layer        | Before                                    | After                            |
| ------------ | ----------------------------------------- | -------------------------------- |
| Deploy       | Dokploy + DigitalOcean + Railway + Render | **Dokploy only**                 |
| DB           | PostgreSQL (pglite in dev)                | **PostgreSQL** (pglite in dev)   |
| Payments     | Stripe app (`apps/stripe`, container)     | **Paystack, built into ShopNex** |
| Shipping     | Shippo app (`apps/shippo`, container)     | **BobGo, built into ShopNex**    |
| Dropshipping | CJ Dropshipping app                       | **removed**                      |
| Marketplace  | hosted Next.js app + sync                 | **removed**                      |
| AI           | Claude / OpenAI                           | **removed**                      |

**Decision: call the Paystack and BobGo APIs from ShopNex core. Do not build bundled apps.**

The merchant enters both API keys in the admin console. ShopNex seals them with `SHOPNEX_SECRET`.
No key goes into an environment variable. No app process runs. No extra container runs.

Result: one image (`shopnex`) and one `db` service. Two payment screens in Settings. Two small API clients.

## 2. Why not bundled apps

The app protocol in this repo is good. It gives isolation and a signed request format.
But each app costs more than the API call it wraps.

| Item                                   | Bundled app (old plan)                  | Built in (this plan)      |
| -------------------------------------- | --------------------------------------- | ------------------------- |
| New processes                          | 2 (paystack, bobgo)                     | 0                         |
| New containers / images                | 2 images, 2 compose services, 2 CI jobs | 0                         |
| App keys, registry sync, `.well-known` | needed for both                         | none                      |
| Settings pages                         | 2 embedded app pages (iframe)           | 2 cards in existing admin |
| Code                                   | 2 apps x ~6 files + tests + Dockerfile  | 2 API clients + wiring    |
| Schema change                          | none                                    | 1 small migration         |
| Webhook                                | app route + app webhook subscription    | 1 public Hono route       |
| Ops surface                            | 4 services to watch                     | 2 services                |

The app protocol stays in the codebase. Custom and marketplace apps still use it.
This migration only stops using it for the two first-party providers.

**Trade-off we accept:** the providers now live inside the ShopNex process.
A slow Paystack or BobGo call uses a ShopNex request slot. Both clients use short timeouts.
BobGo rates already have a 5 s checkout budget.

## 3. Architecture after the migration

### 3.1 Payment

```
Buyer -> checkout -> checkoutService.complete()
                  -> paymentService.startPayment()
                     -> provider "paystack":
                        POST https://api.paystack.co/transaction/initialize
                        <- authorization_url  (stored as paymentSessions.redirectUrl)
Buyer -> Paystack checkout -> pays
Paystack -> POST /api/payments/paystack/webhook?shop=<shopId>
         -> verify HMAC-SHA512 (raw body, shop secret key)
         -> paymentService.resolve(session, externalId)  -> order paid
Buyer -> returnUrl (confirmation page)
       -> paymentService.syncPending() -> GET /transaction/verify/{reference} (fallback)
```

### 3.2 Shipping

```
Checkout -> carrierService.quote()
         -> provider "bobgo":
            POST https://api.bobgo.co.za/v2/rates-at-checkout
            <- rates[] -> CarrierRate[] -> buyer picks one
Order    -> quote again (same code) -> order shipping line = BobGo price
```

No shipment booking in v1. Staff book the courier in the BobGo dashboard.
Phase 7 is the optional follow-up.

## 4. Locked design decisions

1. **Keys live in the admin, sealed at rest.** Use `encryptSecret` from `@shopnex/db/secrets`.
   Never return a saved key to the browser. Show only "Connected" and the last 4 characters.
2. **One generic table for provider settings**: `shop_integrations(shop_id, provider, secret, config, enabled)`.
   Two rows in practice: `paystack`, `bobgo`. No new table per provider.
3. **Paystack reference = payment session id (UUID).** Paystack allows alphanumeric, `-`, `.`, `=`.
   The webhook then finds the session without trusting metadata.
4. **The webhook URL names the shop**: `?shop=<shopId>`. The shop id is not a secret.
   It selects the key for signature verification. A wrong shop id fails verification.
5. **Verify the amount and the currency** before `resolve`. A mismatch is logged and ignored.
6. **Refunds resolve from the API answer**, not from a refund webhook.
   This matches the Stripe app behaviour and keeps the code small.
   Limit: an asynchronous refund failure shows as refunded until staff correct it.
7. **BobGo only for ZA and ZAR.** Hide BobGo rates for any other country or currency. No conversion.
8. **BobGo rate code** = `bobgo:{provider_slug}:{service_level_code}`.
   `service_code` is not stable, so it is a fallback only.
9. **No new npm dependencies.** Use `fetch`, `node:crypto`, `hono`. No Paystack or BobGo SDK.
10. **No new environment variables.** The two providers read only `APP_URL` (for the webhook URL).
11. **Provider union in the DB**: `payment_methods.provider` gets `'paystack'`.
    `carrier_services` gets `provider` (`'app' | 'bobgo'`).
12. **Nullable app links.** `payment_sessions.app_id` and `carrier_services.app_id` become nullable.
    Built-in providers have no app row.
13. **Idempotency.** `resolve` and `reject` already are. A replayed webhook is harmless.
14. **Keep the app protocol.** `registerBundledApps()` stays, with an empty list.
    Deleting the mechanism is not part of this migration.

## 5. What stays, what goes

### Keep

- `modules/api`, `auth`, `cart`, `catalog`, `channels`, `content`, `customers`, `custom-fields`, `db`,
  `email`, `files`, `log`, `orders`, `payments`, `pricing`, `tenancy`, `theme`, `webhooks`
- `modules/apps` (the app protocol; bundled list becomes empty)
- `apps/admin-ui` (admin, checkout, API)
- `templates/storefront`, `templates/app-starter`
- `packages/app`, `app-bridge`, `storefront-sdk`, `marketplace-sdk`, `create-shopnex`
  (`marketplace-sdk` stays: `modules/apps` and `modules/payments` import its signing helpers)
- `deploy/Dockerfile`, one local compose file, one Dokploy compose file

### Remove

- `apps/stripe`, `apps/shippo`, `apps/cj-dropshipping`
- `packages/cj-sdk`
- `modules/ai`
- `apps/marketplace` (not present in this fork; do not create it)
- `apps/docs` (optional; see Phase 5)
- App images and services in `deploy/`, `.github/workflows/demo.yml`, `release.yaml`
- `STRIPE_*`, `SHIPPO_*`, `CJ_DROPSHIPPING_*`, `MARKETPLACE_URL`, `SHOPNEX_BUNDLED_APPS` env readers
- `dev:stripe`, `dev:cj`, `dev:shippo` scripts

Note: `apps/landing` does not exist in this fork. Ignore it.

## 6. Schema changes (Phase 0)

Add `modules/db/src/schema/integrations.ts`:

```ts
export const INTEGRATION_PROVIDERS = ['paystack', 'bobgo'] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const shopIntegrations = pgTable(
  'shop_integrations',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<IntegrationProvider>().notNull(),
    // AES-256-GCM, keyed from SHOPNEX_SECRET (@shopnex/db/secrets)
    secret: text('secret').notNull(),
    // Provider settings that are not secret: collection address, parcel, sandbox, webhook url...
    config: jsonb('config').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.provider] })],
)
```

Changes to existing tables:

```sql
ALTER TABLE payment_sessions ALTER COLUMN app_id DROP NOT NULL;

ALTER TABLE carrier_services ADD COLUMN provider text NOT NULL DEFAULT 'app';
ALTER TABLE carrier_services ALTER COLUMN app_id DROP NOT NULL;
ALTER TABLE carrier_services ALTER COLUMN rates_url DROP NOT NULL;
CREATE UNIQUE INDEX carrier_services_shop_provider_idx
  ON carrier_services (shop_id, provider) WHERE app_id IS NULL;
```

`payment_methods.provider` becomes `'manual' | 'app' | 'paystack'`. `app_id` is already nullable.

Generate the migration with `pnpm db:generate`. It becomes `migrations/0043_*.sql`.
Add `./integrations` to the exports of `modules/db/package.json`.

## 7. Shared helper (Phase 0)

Add `modules/db/src/integrations.ts`:

```ts
export async function getIntegration(shopId: string, provider: IntegrationProvider)
export async function saveIntegration(
  shopId: string,
  provider,
  input: { secret?: string; config?: object; enabled?: boolean },
)
export async function deleteIntegration(shopId: string, provider)
export async function integrationSecret(shopId: string, provider): Promise<string | null> // decrypts
export async function integrationConfig<T>(shopId: string, provider): Promise<T | null>
```

Rules:

- `saveIntegration` keeps the old secret when `secret` is empty.
- `getIntegration` never returns the secret.
- `integrationSecret` returns null when the row is missing or disabled.

Tests (`modules/db/tests/integrations.test.ts`, pglite in memory):

- save → get hides the secret, returns config.
- save with no secret keeps the old key.
- disable → `integrationSecret` returns null.
- delete → row gone.

## 8. Phase plan and dependency graph

```
P0 schema + helper (blocking)
 ├── P1 Paystack client (parallel)
 └── P2 BobGo client (parallel)
      ├── P3 Payments wiring (needs P0, P1)
      └── P4 Shipping wiring (needs P0, P2)  [merge after P3: router.ts]
              └── P5 Removal + deploy + CI + docs (needs P3, P4)
                      └── P6 Verification, screenshots, release (needs all)
                              └── P7 optional: BobGo booking + tracking
```

Time: about 7 engineering days serial. About 3 days with parallel agents.

### Phase 0 — Foundation (blocking, 1 worker)

**Goal:** schema and shared helper, no provider code.

**Files (exclusive):**

- `modules/db/src/schema/integrations.ts` (new)
- `modules/db/src/schema/checkout.ts` (edit: provider union, carrier provider column)
- `modules/db/src/schema/payments.ts` (edit: `appId` nullable)
- `modules/db/src/schema/index.ts` (export integrations)
- `modules/db/src/integrations.ts` (new)
- `modules/db/package.json` (export `./integrations`)
- `modules/db/migrations/0043_*.sql` + `meta/` (generated)
- `modules/db/tests/integrations.test.ts` (new)

**Tasks:**

1. Add the table and the three table edits.
2. Run `pnpm db:generate`. Check the SQL by hand: drop-not-null statements, partial unique index.
3. Add the helper with sealing and config handling.
4. Export the helper from the package.
5. Update any TypeScript break from `appId: string | null` (none expected in schema-only phase).

**Tests:**

- `pnpm --filter @shopnex/db test`
- `pnpm --filter @shopnex/db typecheck`
- Migration applies on a fresh pglite database (the test suite does this through `prepareDatabase`).

**Done when:**

- `pnpm --filter @shopnex/db test` passes.
- `pnpm typecheck` passes for `@shopnex/db`.
- The migration is the only new file in `migrations/`.

---

### Phase 1 — Paystack API client (parallel with P2)

**Goal:** a pure client module. No database, no HTTP routes.

**Files (exclusive):**

- `modules/payments/src/paystack.ts` (new)
- `modules/payments/tests/paystack.test.ts` (new)
- `modules/payments/src/index.ts` (export `* as paystack`)

**Interface:**

```ts
export type PaystackCurrency = 'ZAR' | 'NGN' | 'GHS' | 'USD' | 'KES'
export const PAYSTACK_CURRENCIES: readonly PaystackCurrency[]

export function isPaystackKey(key: string): boolean // sk_test_ / sk_live_
export function verifyWebhookSignature(raw: string, key: string, header: string | undefined): boolean
export async function verifyKey(key: string): Promise<void> // GET /balance
export async function initialize(
  key,
  input: {
    email: string
    amountCents: number
    currency: string
    reference: string
    callbackUrl: string
    metadata: Record<string, unknown>
  },
): Promise<{ authorizationUrl: string; reference: string }>
export async function verifyTransaction(
  key,
  reference,
): Promise<{
  status: string
  amount: number
  currency: string
  id: number
  reference: string
}>
export async function refund(
  key,
  input: {
    transaction: string
    amountCents: number
    currency: string
    reference: string
  },
): Promise<{ id: number; status: string }>
```

**Tasks:**

1. Base URL `https://api.paystack.co`. `Authorization: Bearer <key>`. `content-type: application/json`.
2. Use `AbortSignal.timeout(10_000)` and `redirect: 'error'`. Same shape as `apps/shippo/src/shippo.ts`.
3. Parse `{ status, message, data }`. Throw `Error(message)` on `status === false`.
4. Signature: HMAC-SHA512 over the **raw** body, hex, 128 chars. Compare with `timingSafeEqual`.
   Reject a header that is not 128 hex characters before the compare.
5. `verifyKey` calls `GET /balance`. Success means the key works. Return no key material.
6. Paystack expects `metadata` as a **stringified** JSON object. Send `JSON.stringify(metadata)`.
7. Map Paystack `amount` as integer subunits (cents for ZAR). Never divide by 100 in this module.
8. Add a short header comment with the three endpoints and the docs URL.

**Tests (mock `globalThis.fetch`, like `apps/shippo/tests/shippo.test.ts`):**

- `isPaystackKey`: `sk_test_x` and `sk_live_x` true; `pk_`, `whsec_`, empty false.
- initialize: correct URL, bearer header, body fields, returns `authorization_url`.
- initialize with `status: false`: throws the API `message`.
- verifyTransaction: parses `data.status`, `data.amount`.
- refund: sends `transaction` and `amount`; returns `id` and `status`.
- signature: a valid HMAC passes; one changed byte fails; a short header fails; a missing header fails.
- non-2xx: throws with status and a short body.
- timeout: the signal is set (assert `init.signal` exists).

**Done when:** `pnpm --filter @shopnex/payments test` and `typecheck` pass. No DB import in the new file.

---

### Phase 2 — BobGo API client (parallel with P1)

**Goal:** a pure client module that turns a ShopNex rates request into BobGo rates.

**Files (exclusive):**

- `modules/cart/src/bobgo.ts` (new)
- `modules/cart/tests/bobgo.test.ts` (new)
- `modules/cart/src/index.ts` (export `* as bobgo`)

**Interface:**

```ts
export type BobGoConfig = {
  sandbox: boolean
  collection: {
    company: string
    streetAddress: string
    localArea: string
    city: string
    zone: string
    code: string
  }
  parcel: { itemWeightKg: number; lengthCm: number; widthCm: number; heightCm: number }
}
export const DEFAULT_BOBGO_PARCEL: BobGoConfig['parcel']

export const bobgoBaseUrl = (config: { sandbox: boolean }) => string
export function isBobGoConfig(config: unknown): config is BobGoConfig
export async function verifyKey(key: string, config: BobGoConfig): Promise<void>
export async function quoteRates(
  key: string,
  config: BobGoConfig,
  input: QuoteInput,
): Promise<{ code: string; name: string; priceCents: number; description?: string }[]>
```

**Request mapping:**

| ShopNex                         | BobGo                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| `config.collection.*`           | `collection_address` (`type: 'business'`, `country: 'ZA'`) |
| `input.destination.address1/2`  | `delivery_address.street_address`                          |
| `input.destination.city`        | `local_area` and `city`                                    |
| `input.destination.province`    | `zone`                                                     |
| `input.destination.zip`         | `code`                                                     |
| `input.destination.countryCode` | `country` (**must be `ZA`**)                               |
| cart line title                 | `items[].description`                                      |
| cart line `quantity`            | `items[].quantity`                                         |
| `priceCents / 100`              | `items[].price` (ZAR)                                      |
| `config.parcel.*`               | per-item `weight_kg`, `length_cm`, `width_cm`, `height_cm` |
| `subtotalCents / 100`           | `order_total_price` and `declared_value`                   |

**Response mapping:**

- `rates` null or `[]` → return `[]` (hide delivery; do not show R0).
- `total_price` (ZAR number) → `Math.round(total_price * 100)`.
- `service_name` → `name`.
- `provider_slug` + `service_level_code` → code `bobgo:{slug}:{slug}`.
  Fallback: `bobgo:rate:{id}`. Add a `ponytail:` comment that the fallback may not match on re-quote.
- `min_delivery_date`/`max_delivery_date` → description like `Door · 2-4 days`.
- Sort by `priceCents` ascending, cap at 20, drop duplicates by code.

**Tasks:**

1. Guards: return `[]` when `input.currency !== 'ZAR'` or country is not `ZA`.
2. Import `QuoteInput` with `import type` from `./carrier-services`. A type-only import adds no runtime cycle.
3. Drop `fulfilledBy` items (same rule as Shippo: `ownItems`).
4. Empty item list → `[]`.
5. Timeout 4500 ms (checkout waits 5 s in total).
6. `verifyKey`: one real `POST /v2/rates-at-checkout` with the collection address as the delivery
   address, one small item, and `country: 'ZA'`. A 2xx means the key works.
   A 401/403 throws "BobGo rejected this API key". Other errors throw the API message.
7. Log no keys. Errors carry only status and a short body.

**Tests (mock fetch):**

- base URL sandbox vs production.
- country guard: `US` → `[]`, no fetch call.
- currency guard: `USD` → `[]`, no fetch call.
- `rates: null` → `[]`.
- `rates: []` → `[]`.
- two rates → cheapest first, cents are correct (`total_price: 95.5` → `9550`).
- code from provider/service level; fallback code when they are missing.
- description from dates; null dates → `null`.
- dropped `fulfilledBy` item: not in the request body.
- request body has `order_total_price` in ZAR (not cents).
- a 500 throws with the status; `quoteRates` returns `[]` only through the caller, not by hiding programmer errors.
  (Make `quoteRates` throw; `carrier-services.ts` catches.)
- `verifyKey` sends a valid body and throws on 401.

**Done when:** `pnpm --filter @shopnex/cart test` and `typecheck` pass.

---

### Phase 3 — Payments wiring (needs P0, P1)

**Goal:** Paystack is a real payment method. Staff save the key in the admin. Buyers pay. Orders resolve.

**Files (exclusive):**

- `modules/payments/src/sessions.ts` (edit: start, refund, provider branches)
- `modules/payments/src/methods.ts` (edit: built-in method upsert + provider type)
- `modules/payments/src/paystack-settings.ts` (new: save/verify/disconnect for the shop)
- `modules/payments/tests/paystack-sessions.test.ts` (new, pglite)
- `modules/api/src/app.ts` (edit: webhook route)
- `modules/api/src/routers/admin/payments.ts` (edit: `paystack` group)
- `modules/api/src/router.ts` (edit: register the group)
- `apps/admin-ui/src/screens/settings/paystack-card.tsx` (new)
- `apps/admin-ui/src/routes/admin/settings/payments.tsx` (edit: render the card)
- `apps/admin-ui/src/screens/settings/payment-methods-card.tsx` (edit: Type column shows "Paystack")
- `apps/admin-ui/src/screens/checkout/functions.ts` (edit: call `syncPending` on the confirmation page)
- `modules/cart/src/checkout.ts` (edit: `offsite` and `gateway` snapshot for non-manual providers)
- `packages/app/src/admin-api.gen.ts` (regenerated)

**Tasks — settings service (`paystack-settings.ts`):**

1. `get(shopId)` → `{ connected, last4, currency, webhookUrl }`. Never the key.
2. `save(shopId, { secretKey })`:
   - reject a key that is not `sk_test_`/`sk_live_`;
   - call `paystack.verifyKey`; on error return `INVALID_KEY` with the message;
   - reject when the shop currency is not in `PAYSTACK_CURRENCIES`;
   - `saveIntegration(shopId, 'paystack', { secret, config: { currency }, enabled: true })`;
   - upsert the payment method:
     ```ts
     { name: 'Pay with Paystack', provider: 'paystack', gateway: 'paystack',
       ready: true, appId: null, paymentSessionUrl: null, refundSessionUrl: null }
     ```
     Use the existing `(shopId, appId)` uniqueness only for apps. Add a dedicated upsert by
     `(shopId, provider)` in `methods.ts`; do not reuse `configure()`.
   - `position`: first, like card methods (`min(position) - 1`).
3. `disconnect(shopId)`: delete the integration row and the `provider = 'paystack'` method.
4. `webhookUrl(shopId)` = `${APP_URL}/api/payments/paystack/webhook?shop=${shopId}`.
5. Toggle `enabled` without deleting the key (sets `ready` false/true on the method).

**Tasks — `startPayment` (`sessions.ts`):**

1. Keep the reuse rule and the "expire the old attempt" rule.
2. Method check by provider:
   - `manual` → `NOT_PAYABLE`.
   - `app` → existing rules (`appId`, URL, `installed()`).
   - `paystack` → require an enabled integration with a secret. No app check.
3. Insert the session with `appId: null` for paystack.
4. Call `paystack.initialize` **after** the transaction commits (same rule as the app call).
   Use `reference: session.id`, `callback_url: request.returnUrl`,
   `metadata: { shopId, orderId, sessionId: session.id }`.
5. Store `redirectUrl`. On error: close the session as rejected and throw `PROVIDER_UNAVAILABLE`.
6. `syncPending(shopId, orderId)`: for the latest pending paystack session older than 15 s,
   call `verifyTransaction`; resolve on `success`, leave it open otherwise. Never throw to the page.

**Tasks — refunds (`startRefunds`):**

1. Read the paid method. If `provider === 'paystack'`:
   - call `paystack.refund` with `transaction = session.externalId`, `amountCents`, `currency`,
     `reference = refund session id`;
   - `resolve` on a status that is not failed; `reject` on failure.
2. App path unchanged.
3. A missing `externalId` fails the refund transaction with a clear message.

**Tasks — webhook (`app.ts`):**

1. `app.post('/payments/paystack/webhook', ...)`. The Hono base path is `/api`, so the public URL matches.
2. Read `c.req.text()` **before** any JSON parse. Read `shop` from the query.
3. Load the integration secret. Unknown shop or no key → 401.
4. Verify `x-paystack-signature`. Invalid → 401 with no detail.
5. Parse `{ event, data }`. Handle only:
   - `charge.success`: find the session by `data.reference`, require `pending`, check
     `data.amount === session.amountCents` and `data.currency === session.currency`;
     `resolve(shopId, null, session.id, { externalId: String(data.id) })`.
   - `charge.failed`: `attemptFailed(shopId, null, data.reference, { reason: data.gateway_response })`.
6. Other events → 200 and ignore. Unknown reference → 200 (avoid retries for old sessions).
7. Always answer 200 quickly after the DB work. Log the event and the session id, never the payload.
8. Add a comment that the newer `Paystack-Signature` header exists. v1 uses `x-paystack-signature`.
   Paystack still sends it while the integration has a secret key.

**Tasks — API (`admin/payments.ts`, `router.ts`):**

1. Add `paystack: { get, save, disconnect, toggle }` to the existing `adminPayments` router export
   in `admin/payments.ts`. It becomes `admin.paystack` in `router.ts`, next to `paymentMethods`.
   Use `shopManager` auth. Input: `{ secretKey: string }` (write-only), `{ enabled: boolean }`.
2. Register `paystack: tagged('Admin · Payments').router(adminPaystack)` in `router.ts`.
3. Run `pnpm --filter @shopnex/app generate` and commit the generated types.

**Tasks — admin UI:**

1. `PaystackCard`:
   - states: not connected / connected / error;
   - fields: secret key (`type="password"`, autocomplete off), Save, Disconnect;
   - shows the webhook URL with a copy button;
   - shows "Test key" or "Live key" and the last 4 characters;
   - explains: "Paste this webhook URL in Paystack → Developers → API configuration".
2. Render it in `routes/admin/settings/payments.tsx`.
3. `payment-methods-card.tsx`: Type column → `Paystack` for `provider === 'paystack'`.
4. No screenshots in this phase. Phase 6 takes them.

**Tests:**

- Unit (mock fetch): `paystack-settings.save` rejects a bad key, rejects a non-supported currency,
  upserts the method, and never returns the secret.
- Integration (pglite): `startPayment` on a paystack method creates a session with `appId: null`,
  stores the redirect URL, and reuses a live session.
- Integration: webhook success resolves the order (`financialStatus = 'paid'`), a wrong amount does not,
  a wrong signature does not, a replay does not double-charge.
- Integration: cancel an order after a paystack payment → refund called, transaction success.
- Integration: `syncPending` resolves a session the webhook missed.
- e2e (later, Phase 6): full checkout against a local fake Paystack server.
  Point the client at a test base URL through a module-level exported `PAYSTACK_BASE_URL` that defaults
  to the real one and can be replaced in tests? **No** — do not add a hidden env. Instead inject `fetch`
  in tests, and keep e2e at the module level.

**Done when:**

- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shopnex/payments test` pass.
- A shop with a sandbox key reaches the Paystack page and a `charge.success` marks the order paid.
- No secret appears in logs, API responses, or the generated types.

---

### Phase 4 — Shipping wiring (needs P0, P2; merge after P3)

**Goal:** BobGo quotes rates at checkout. Staff save the key and the collection address in the admin.

**Files (exclusive):**

- `modules/cart/src/carrier-services.ts` (edit: provider branch, built-in upsert)
- `modules/cart/src/bobgo-settings.ts` (new: save/verify/toggle for the shop)
- `modules/cart/tests/bobgo-rates.test.ts` (new, pglite or pure)
- `modules/api/src/routers/admin/carrier-services.ts` (edit: `bobgo` group)
- `modules/api/src/router.ts` (edit: register; merge after P3)
- `apps/admin-ui/src/screens/settings/bobgo-card.tsx` (new)
- `apps/admin-ui/src/routes/admin/settings/shipping.tsx` (edit: render the card)
- `apps/admin-ui/src/screens/settings/carrier-services-card.tsx` (edit: label built-in services)
- `packages/app/src/admin-api.gen.ts` (regenerated)

**Tasks — settings service:**

1. `get(shopId)` → `{ connected, sandbox, collection, parcel, last4 }`.
2. `save(shopId, input)`:
   - validate the collection address (street, city, zone, code, country = ZA);
   - validate the parcel numbers (positive, bounded);
   - call `bobgo.verifyKey`; a failure returns `INVALID_KEY` and does not save;
   - `saveIntegration(shopId, 'bobgo', { secret, config: { sandbox, collection, parcel } })`;
   - upsert the carrier service:
     ```ts
     { provider: 'bobgo', name: 'BobGo', appId: null, ratesUrl: null, ready: true }
     ```
     Match by `(shopId, provider)` where `app_id is null`.
3. `disconnect`: delete the row and the carrier service.
4. `toggle(enabled)`: set the carrier service `ready` and the integration `enabled`.
5. `verifyKey` uses the sandbox or production base URL from the saved config.

**Tasks — `carrier-services.ts`:**

1. `list()` returns app and built-in rows. `usableOnly` keeps `active && ready`.
2. `quote()` splits services:
   - `provider === 'app'` → signed `post()` (unchanged);
   - `provider === 'bobgo'` → load the integration secret + config once, call `bobgo.quoteRates`.
     One integration read per shop per quote, not per service.
3. Catch everything: a BobGo failure gives `[]` for that service, like an app failure.
   Checkout carries on with flat rates.
4. `configure()` stays app-only. Add `upsertBuiltin(shopId, provider, input)` for BobGo.
5. Rate id stays `carrier:{serviceId}:{code}`. The order stores the price snapshot.
6. If a chosen code is gone on re-quote, try the same price; else throw `INVALID_SHIPPING_RATE`.
   Add a `ponytail:` comment naming the limitation.

**Tasks — API + UI:**

1. Add `bobgo: { get, save, disconnect, toggle }` to the existing `adminCarrierServices` router.
   It becomes `admin.carrierServices.bobgo`. Use `shopManager`.
2. `BobGoCard`:
   - key field (`type="password"`), sandbox switch, collection address fields, parcel defaults;
   - "Connected" badge and last 4 characters;
   - note: "Rates use your BobGo checkout rules. Book the courier in BobGo."
3. Render it in `routes/admin/settings/shipping.tsx`, above the app cards.
4. `carrier-services-card.tsx`: show "Built in" instead of an app name for `provider !== 'app'`.
5. Regenerate the Admin API types.

**Tests:**

- Unit: settings validation (missing street, country not ZA, zero weight).
- Unit: `verifyKey` throws on 401 and saves nothing.
- Integration: `quote()` with a bobgo service calls the API once and returns its rates.
- Integration: a non-ZA destination returns `[]` and no HTTP call.
- Integration: a BobGo 500 returns `[]`; flat shipping rates still show.
- Integration: `upsertBuiltin` is idempotent (two saves, one row).
- Integration: uninstall/disable removes the service from checkout.
- Integration: order placement re-quotes and stores the BobGo price.

**Done when:** `pnpm --filter @shopnex/cart test`, `typecheck`, `lint` pass.
BobGo sandbox rates show at checkout for a ZA address.

---

### Phase 5 — Removal, deploy, CI, env, docs (needs P3, P4)

**Goal:** the old providers and the extra deploy surface are gone.

**Files (exclusive):**

- `apps/stripe/`, `apps/shippo/`, `apps/cj-dropshipping/`, `packages/cj-sdk/` (delete)
- `modules/ai/` (delete; optional, see below)
- `modules/apps/src/apps.ts` (empty `BUNDLED_APPS`, remove `registerBundledApps` call in admin-ui)
- `apps/admin-ui/src/server.ts` (remove the call)
- `modules/api/src/router.ts` (remove the AI router; merge after P4)
- `modules/api/src/env-vars.ts` + `modules/api/tests/env-vars.test.ts` (if it lists names)
- `.env.example`
- `deploy/docker-compose.yml`, `deploy/docker-compose.dokploy.yml`, `deploy/dokploy-template/*`
- `deploy/Dockerfile.app`, `deploy/start.sh`, `deploy/shopnex-update.sh`, `deploy/Caddyfile.apps`,
  `deploy/Caddyfile.shops` (delete; keep `deploy/Caddyfile` if the local compose needs it)
- `.github/workflows/ci.yaml`, `demo.yml`, `release.yaml`, `create-shopnex.yaml`
- `scripts/smoke-app.sh`, `scripts/smoke-proxy.sh`, `scripts/bundle-app.mjs`, `scripts/build-node-bundle.mjs`
- `packages/create-shopnex/src/extras.ts`, `src/app-keys.ts`, `tests/extras.test.ts`
- root `package.json`
- `modules/tenancy/src/subdomains.ts`
- `README.md`, `docs/*` that name Stripe/Shippo/CJ

**Tasks — code:**

1. Delete the three apps, `packages/cj-sdk`, `modules/ai`.
   Before `modules/ai`: run `rg "modules/ai|@shopnex/ai"`. Remove the router, settings route,
   `apps/admin-ui/src/routes/admin/settings/ai.tsx`, `screens/settings/ai-card.tsx`,
   and the `aiProviders` cleanup in `modules/apps/src/apps.ts` uninstall.
   Keep the `ai_*` tables for now, or add a drop migration. Dropping is a separate decision: keep the tables.
2. `BUNDLED_APPS = []`. Keep `registerBundledApps()` and the sync code. Remove the call from
   `apps/admin-ui/src/server.ts` (it would do nothing) **or** keep it; choose one and say why in the PR.
   Recommendation: remove the call, keep the function exported.
3. `modules/tenancy/src/subdomains.ts`: remove `stripe`; keep `marketplace`, `apps`, `docs`.
   Add `paystack` and `bobgo`.
4. `env-vars.ts`: remove `STRIPE_APP_URL`, `CJ_DROPSHIPPING_APP_URL`, `SHIPPO_APP_URL`,
   `SHOPNEX_BUNDLED_APPS`, `MARKETPLACE_URL` when nothing reads them. Add none.
5. `.env.example`: remove the app block. Add a short comment: "Paystack and BobGo keys are entered in
   Admin → Settings → Payments / Shipping."
6. Root `package.json`: remove `dev:stripe`, `dev:cj`, `dev:shippo`, `dev:docs` if `apps/docs` goes.
7. `create-shopnex`: remove the stripe/cj/shippo extras and app keys. Keep the CLI working with no apps.
8. Update `e2e/tests/apps.test.ts`, `app-install-order.test.ts`, `ai.test.ts`,
   `browser/checkout-payments.spec.ts` and the demo seed only where they name removed apps.
   Keep the fake-app e2e tests: they prove the protocol still works for custom apps.

**Tasks — deploy:**

1. `deploy/docker-compose.yml`: `db` + `shopnex` only. Remove app services, profiles, keys,
   `SHOPNEX_BUNDLED_APPS`, and the app URLs from the header comment.
2. `deploy/docker-compose.dokploy.yml`: `db` + `shopnex` only. Keep the Traefik multi-shop labels.
3. `deploy/dokploy-template/`: `docker-compose.yml` (db + shopnex), `template.toml`
   (one domain, port 3000, `APP_URL`, `SHOPNEX_SECRET`, `SHOPNEX_VERSION`).
4. Delete `deploy/Dockerfile.app`, `deploy/start.sh`, `deploy/shopnex-update.sh`,
   `deploy/Caddyfile.apps`, `deploy/Caddyfile.shops`, `.do/`, `render.yaml` if unused.
5. Keep one Dockerfile (`deploy/Dockerfile`).

**Tasks — CI:**

1. `ci.yaml`: delete the `app-image` matrix job and the `proxy-headers` job if it only tests apps.
2. `demo.yml`: build only the shopnex image.
3. `release.yaml`: build only the `shopnex` image (amd64 + arm64). Remove the app matrix entries.
4. `create-shopnex.yaml`: remove the `--with` app checks; keep the install test.

**Tests:**

- `pnpm install --frozen-lockfile` with no app workspaces.
- `rg -n "stripe|shippo|cj-dropshipping|cj-sdk"` returns only historical docs and the protocol tests
  that intentionally keep a "stripe" name for a fake app.
- `docker compose -f deploy/docker-compose.dokploy.yml config` is valid (no missing env).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`.

**Done when:** CI is green on a fresh clone with no app images.

---

### Phase 6 — Verification, screenshots, release (needs all)

**Goal:** prove the flow end to end and ship it.

**Tasks:**

1. Sandbox accounts: one Paystack test key, one BobGo sandbox key. Use demo data only.
2. Paystack flow:
   - save the key in Settings → Payments;
   - copy the webhook URL into the Paystack dashboard (use a tunnel for localhost);
   - checkout with a test card; the Paystack page opens; pay; the order shows paid;
   - refund from the order; the Paystack dashboard shows the refund;
   - wrong key → clear error, nothing saved;
   - cancel before paying → order cancelled after the window.
3. BobGo flow:
   - save the key and a ZA collection address;
   - a ZA address at checkout gets BobGo rates; a US address gets flat rates only;
   - a cart below/above a BobGo rule shows the configured price;
   - no rates for an excluded area: delivery is hidden, no R0 line;
   - place the order; the shipping line keeps the quoted price.
4. Take screenshots (CLAUDE.md rules):
   - Settings → Payments → Paystack card (empty)
   - Settings → Payments → Paystack card (connected)
   - Settings → Shipping → BobGo card (filled)
   - checkout with BobGo rates
   - checkout on the Paystack page? No: never a real payment page. Use the redirect state only.
     Put them in the PR folder of `shopnex-ai/shopnex-screenshots`.
5. Update `README.md` and the install docs.
6. Tag a release. Watch the single image build.

**Done when:** the checklist in section 9 is fully ticked.

---

### Phase 7 — Optional: BobGo booking and tracking

Do not build this now. Add it when staff need labels inside ShopNex.

Scope when needed:

- `POST /v2/shipments` after fulfilment, with the chosen rate's `provider_slug`, `service_level_code`,
  addresses, parcels, contacts and `selected_rate_request_id`;
- store `tracking_reference` and `provider_tracking_reference` on the order fulfilment;
- webhook `shipment_submission_status/updated` and `tracking/updated`;
- a "Book with BobGo" button on the order page.

This needs an order-fulfilment field, a webhook route and a retry worker. It is a separate PR.

## 9. Verification checklist

- [ ] `pnpm install --frozen-lockfile` succeeds with no `apps/stripe`, `apps/shippo`, `apps/cj-dropshipping`
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` pass
- [ ] `pnpm --filter @shopnex/app generate` produces no diff
- [ ] `docker compose -f deploy/docker-compose.dokploy.yml config` is valid
- [ ] `docker compose -f deploy/docker-compose.dokploy.yml up` starts 2 services: `db`, `shopnex`
- [ ] Settings → Payments shows the Paystack card; a test key saves and shows Connected
- [ ] Settings → Payments shows "Pay with Paystack" as a method, first in the list
- [ ] `charge.success` marks the order paid; a replay does not change it
- [ ] A wrong amount in the webhook does not mark the order paid
- [ ] Refund from the order page reaches Paystack
- [ ] Settings → Shipping shows the BobGo card; key + address save and show Connected
- [ ] A ZA checkout shows BobGo rates; a US checkout shows flat rates only
- [ ] A no-coverage ZA area hides delivery; no R0 option
- [ ] An order keeps the BobGo price it was placed with
- [ ] No key is visible in any API response, log line, or screenshot
- [ ] `rg "STRIPE_|SHIPPO_|CJ_DROPSHIPPING_|SHOPNEX_BUNDLED_APPS"` is empty outside docs history

## 10. Test matrix

| Level                | What                                                | Where                                                                         | Runs in CI |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| Unit                 | signature, currency, mapping, guards                | `modules/payments/tests/paystack.test.ts`, `modules/cart/tests/bobgo.test.ts` | yes        |
| Integration (pglite) | start payment, webhook, refund, sync, rates, upsert | `modules/payments/tests/*.test.ts`, `modules/cart/tests/*.test.ts`            | yes        |
| Build                | migration applies on a fresh DB                     | `@shopnex/db` test + `pnpm db:migrate`                                        | yes        |
| e2e app protocol     | custom app install, signed session, resolve         | `e2e/tests/payments.test.ts`, `carrier-services.test.ts`                      | yes (kept) |
| e2e browser          | checkout page states, shipping selector             | `e2e/browser/*`                                                               | yes        |
| Manual               | Paystack sandbox, BobGo sandbox                     | Phase 6                                                                       | no         |
| Manual               | admin screens, screenshots                          | Phase 6                                                                       | no         |

## 11. Risks and mitigations

| Risk                              | Effect                                      | Mitigation                                                                         |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Paystack webhook missed           | Order stays pending                         | `syncPending` on the confirmation page; the expiry worker cancels unpaid orders    |
| Webhook spoofing                  | Fake "paid"                                 | Verify HMAC on the raw body before parsing; verify amount + currency               |
| Key leak in logs                  | Account takeover                            | Never log bodies or headers; mask the key in the UI; seal at rest                  |
| BobGo slow (> 5 s)                | No rates at checkout                        | 4.5 s timeout; failure = no rates, flat rates still show                           |
| BobGo `service_code` changes      | Re-quote cannot match the choice            | Match by provider + service level; fallback by price; else ask the buyer again     |
| Non-ZAR shop enables BobGo        | Wrong prices                                | Hard guard: ZA + ZAR only; the card refuses to save otherwise                      |
| Paystack refund is async          | Order shows refunded before the money moves | Document it; staff check the Paystack dashboard; add the refund webhook in Phase 7 |
| `app_id` nullable breaks a query  | Runtime error                               | Typecheck + pglite tests cover resolve/reject/refund paths                         |
| Deleting AI/marketplace too early | Large unrelated diff                        | Phase 5 is separate; do it after P3/P4 are green                                   |
| Two workers edit `router.ts`      | Merge conflict                              | Merge order P3 → P4; only one worker owns the file at a time                       |

## 12. Rollback

1. Keep the old providers until Phase 5 is green.
2. If Paystack fails in production: disconnect the method in Settings. Manual methods still work.
3. If BobGo fails: switch its carrier service off. Flat rates return at once.
4. The migration only adds a table and relaxes NOT NULL. Reverting the code leaves the columns in place.
   No data is lost.
5. Keep the Stripe/Shippo images tagged for one release cycle if the removal is not yet merged.

## 13. ORCA dispatch plan

Use one worktree per phase. Branch names below. Do not start a phase before its gate is green.

| Worker               | Branch              | Depends on          | Owns                                                                                               |
| -------------------- | ------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `p0-foundation`      | `mig/p0-foundation` | —                   | `modules/db/**` (schema, helper, migration, tests)                                                 |
| `p1-paystack-client` | `mig/p1-paystack`   | P0                  | `modules/payments/src/paystack.ts`, its test, payments index                                       |
| `p2-bobgo-client`    | `mig/p2-bobgo`      | P0                  | `modules/cart/src/bobgo.ts`, its test, cart index                                                  |
| `p3-payments`        | `mig/p3-payments`   | P0, P1              | payments module, `api/app.ts`, `admin/payments.ts`, `router.ts`, Paystack card, checkout functions |
| `p4-shipping`        | `mig/p4-shipping`   | P0, P2, P3 (router) | cart carrier code, `admin/carrier-services.ts`, BobGo card                                         |
| `p5-removal`         | `mig/p5-removal`    | P3, P4              | deletions, deploy, CI, env, docs, create-shopnex                                                   |
| `p6-verify`          | `mig/p6-verify`     | all                 | e2e, screenshots, README, release                                                                  |

### 13.1 Rules for every worker

- Read this document and the files you will touch. Read them fully before you edit.
- Edit only the files in your phase. If you need another file, stop and report it.
- Do not add dependencies. Do not add containers. Do not add env vars for the keys.
- Do not log a secret, a full webhook body, or an authorization header.
- Follow the local style: comments explain _why_, not _what_. No new abstractions for one caller.
- Run: `pnpm typecheck`, `pnpm lint`, and the tests of your package.
- Report in this form:
  ```
  Phase: P3
  Branch: mig/p3-payments
  Changed: <files>
  Tests: <command> -> pass/fail (count)
  Gates: <which checklist items are now true>
  Risks: <anything the next worker must know>
  Blocked: <file or decision you need>
  ```

### 13.2 Worker prompts

**P0**

```
Work in a worktree on branch mig/p0-foundation. Read docs/paystack-bobgo-migration.md sections 5-7.
Implement Phase 0 only: the shop_integrations table, the three table edits, the migration, the
@shopnex/db/integrations helper, and its pglite tests. Run pnpm db:generate, inspect the SQL,
run pnpm --filter @shopnex/db test and typecheck. Do not touch payments, cart, api, or admin-ui.
Report with the handoff form in section 13.1.
```

**P1**

```
Work in a worktree on branch mig/p1-paystack. Read docs/paystack-bobgo-migration.md sections 4 and 8
(Phase 1). Implement modules/payments/src/paystack.ts and its unit tests. Mock globalThis.fetch, as
apps/shippo/tests/shippo.test.ts does. No database, no Hono, no new dependency. Run
pnpm --filter @shopnex/payments test and typecheck. Report with the handoff form.
```

**P2**

```
Work in a worktree on branch mig/p2-bobgo. Read docs/paystack-bobgo-migration.md sections 3, 4 and 8
(Phase 2). Implement modules/cart/src/bobgo.ts and its unit tests. Use fetch, 4500 ms timeout,
ZA/ZAR guards. Mock globalThis.fetch. No database, no Hono, no new dependency. Run
pnpm --filter @shopnex/cart test and typecheck. Report with the handoff form.
```

**P3**

```
Work in a worktree on branch mig/p3-payments. Read docs/paystack-bobgo-migration.md sections 3, 4,
6, and 8 (Phase 3). Implement the Paystack settings service, the startPayment and refund branches,
the webhook route in modules/api/src/app.ts, the admin router, the Paystack settings card, and the
checkout provider fixes. Keep the app path unchanged. Run pnpm typecheck, pnpm lint,
pnpm --filter @shopnex/payments test, and pnpm --filter @shopnex/app generate.
Do not edit modules/cart/src/carrier-services.ts or the BobGo card (P4 owns them).
Report with the handoff form.
```

**P4**

```
Work in a worktree on branch mig/p4-shipping. Rebase on mig/p3-payments first (router.ts).
Read docs/paystack-bobgo-migration.md sections 3, 4, 6, and 8 (Phase 4). Implement the BobGo
settings service, the provider branch in carrier-services.ts, the built-in upsert, the admin router,
and the BobGo settings card. Run pnpm typecheck, pnpm lint, pnpm --filter @shopnex/cart test,
and pnpm --filter @shopnex/app generate. Report with the handoff form.
```

**P5**

```
Work in a worktree on branch mig/p5-removal. Read docs/paystack-bobgo-migration.md section 8 (Phase 5).
Delete the three apps, packages/cj-sdk and modules/ai. Simplify deploy to db + shopnex. Update CI,
env docs, create-shopnex and the README. Keep the app protocol and the fake-app e2e tests.
Run pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm build, pnpm test, and
docker compose config. Report with the handoff form.
```

**P6**

```
Work in a worktree on branch mig/p6-verify. Read docs/paystack-bobgo-migration.md sections 9-11 and
CLAUDE.md. Run the manual sandbox flows, fix what fails in the phase that owns it, take the four
screenshots, update the PR, and tick the checklist. Do not change provider behaviour without saying so.
Report with the handoff form.
```

### 13.3 Merge order and gates

1. Merge P0 to `main`. Gate: db tests green, migration applies.
2. Merge P1 and P2 in any order. Gate: unit tests green.
3. Merge P3. Gate: payments tests green, admin types regenerated.
4. Rebase P4 and merge. Gate: cart tests green.
5. Merge P5. Gate: full CI green, compose valid, `rg` checks empty.
6. Merge P6. Gate: checklist fully ticked.

If two workers must touch the same file, the later one rebases and reruns its tests.
Never resolve a conflict in `router.ts`, `schema/index.ts`, or the compose files without rerunning
the full typecheck.

## 14. What this plan deliberately skips

- No Paystack SDK, no BobGo SDK: `fetch` is enough.
- No app containers, no app keys, no app registry entries for these two providers.
- No separate webhook secret for Paystack: the secret key signs the webhook.
- No shipment booking, no tracking webhook, no label printing (Phase 7).
- No multi-currency conversion: BobGo is ZA/ZAR only. Paystack uses the shop currency.
- No new database per provider: one `shop_integrations` table.
- No env vars for the keys: the admin console is the only place.

Add each skipped item only when a real merchant asks for it.
