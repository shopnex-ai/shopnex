# Order inquiry app experiment

An optional, out-of-process example for [issue #33](https://github.com/shopnex-ai/shopnex/issues/33).
It uses `@shopnex/app` and pinned `refmint@0.1.0-alpha.3` to encode an existing order UUID,
check a quoted reference, and open that order in the authenticated shop's admin.
It requests only `read_orders`. It does not change core order numbers, checkout, payments,
the database schema, customer emails or webhooks. No alias mapping is stored.

## Evaluate the existing workflow first

Shopnex already searches by `#1001`, email and customer name. Those are usually easier
to use than an additional code. A valid-but-mistyped number can identify another existing
order; the checksum offers a distinct invalid-input outcome before an order read.
This is an error-detection experiment, not evidence that merchants need another reference.

The fixture compares the same order's five-character number (`#1001`), 36-character UUID
and the 49-character formatted RefMint code (41 without grouping). The tests make all
1,054 one-symbol substitutions in the header/payload/checksum and check rejection before
the order API is called. They also show that a different,
correctly checksummed reference remains valid. This is synthetic evidence, not a human
transcription study or a guarantee that all mistakes are detected.

The UUID is reversible and public. A checksum is not authorization, a signature or a
checkout credential. Do not use the code as a public order-access link. Staff must sign
in through the SDK, the Admin API must still enforce shop/scopes, and staff should confirm
the record before taking any action. Keep native lookup if it already meets the need.
RefMint is an alpha dependency; the UUID format is v1, namespace `order`.

## Run locally

Use a Shopnex checkout and its documented Node/pnpm versions. The app SDK is a workspace
package, so this directory is not an independently installable npm app.

1. From the repository root, run `pnpm install` and start the development shop as described
   in [development.md](../../docs/development.md).
2. Register a **custom managed app** in the admin, with App URL `http://localhost:4501`,
   no redirect URLs and only `read_orders`. Copy its client ID and private key into a
   local `templates/order-inquiry/.env`, using `.env.example`. Never commit those values.
3. Run `pnpm --filter shopnex-order-inquiry start`, install the custom app in your test shop,
   and open it from the admin. It uses the SDK's session verification and token exchange.
4. In another admin tab open an order and copy its URL. Paste it into **Order link** to
   produce a selectable code. Paste that code into **Order reference** to open the same
   order. Change one character and try again: it should show an error, without reading an order.

There is no public anonymous lookup or automatic customer delivery. Production hosting,
marketplace listing and merchant usability evaluation are outside this example. A deployed
app needs the SDK's usual HTTPS/marketplace trust configuration and operational review.

## Checks

```sh
pnpm --filter shopnex-order-inquiry test
pnpm --filter shopnex-order-inquiry typecheck
pnpm exec eslint templates/order-inquiry
pnpm exec prettier --check templates/order-inquiry
# With the development shop and its test database running:
pnpm --filter @shopnex/e2e exec tsx --env-file-if-exists=../.env --test tests/order-inquiry.test.ts
```

The self-contained tests run the real SDK's Ed25519 session verification, client assertion,
token exchange and AdminClient against an ephemeral loopback fixture. They cover missing,
expired, tampered and wrong-audience sessions; malformed and mistyped references; unknown
and foreign-shop orders; revoked/read-denied access; upstream failures; and bounded input.
The fixture models the Admin API. The separate `e2e/tests/order-inquiry.test.ts` exercises
the actual installed app, token exchange, order lookup, cross-shop rejection and uninstall
revocation against the running Shopnex API and PostgreSQL, with cleanup through `Fixtures`.
Neither suite replaces merchant usability testing or a browser check of the embedding flow.

Upstream source baseline: `32238045294f53abfa1f0c91310f4ff2e03e216f`.
Native lookup: `modules/orders/src/orders.ts`; SDK contract: `packages/app/src/index.ts`;
scope enforcement: `modules/api/src/routers/admin/orders.ts`.
