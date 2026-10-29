# @shopnex/marketplace-sdk

The contract and typed client for the Shopnex App Marketplace API, plus the keys, session tokens and signed requests that
apps and Shopnex instances exchange.
Most apps use this through [`@shopnex/app`](https://github.com/shopnex-ai/shopnex/tree/main/packages/app); use
this package directly to check tokens and requests yourself, or when working on an instance or the marketplace.

## Installation

Inside this repository, packages depend on the workspace copy:

```json
"@shopnex/marketplace-sdk": "workspace:*"
```

`pnpm add @shopnex/marketplace-sdk` works only once the package is published to npm; the release workflow does not
publish it today.

## Usage

Verify the session token an embedded app's frontend sends its backend (from `@shopnex/app-bridge`, or `?session_token=`
on the embedded load). The instance's public keys are fetched from the origin in the token and cached:

```ts
import { createJwksResolver, verifySessionToken } from '@shopnex/marketplace-sdk'

const clientId = process.env.SHOPNEX_CLIENT_ID!
const keys = createJwksResolver()

const claims = await verifySessionToken(token, { clientId, keys })
if (!claims) throw new Error('Invalid session token')
// claims.iss is the instance origin, claims.shop_id the shop, claims.sub the staff user
```

Marketplace apps: anyone can run a Shopnex instance, so confirm a new install with the marketplace before trusting
it (custom apps skip this):

```ts
import { createClientAssertion, createMarketplaceClient } from '@shopnex/marketplace-sdk'

const marketplaceUrl = process.env.SHOPNEX_MARKETPLACE_URL! // http://localhost:3200 in development
const appKey = process.env.SHOPNEX_APP_KEY! // the app's snxk_… private key

const marketplace = createMarketplaceClient({ baseUrl: marketplaceUrl })
const { installed } = await marketplace.installations.verify({
  client_id: clientId,
  client_assertion: await createClientAssertion(appKey, clientId, marketplaceUrl),
  instance_url: claims.iss,
  shop_id: claims.shop_id,
})
if (!installed) throw new Error('The marketplace has no record of this install')
```

## Entry points

- `@shopnex/marketplace-sdk`: `createMarketplaceClient`, the contract and its schemas, session tokens, the key helpers
  apps need (`createJwksResolver`, `createClientAssertion`, `generateKeyPair`), and oRPC's `ORPCError` and `safe`.
- `@shopnex/marketplace-sdk/contract`: `marketplaceContract`, its zod schemas (`CatalogApp`, `CatalogTheme`,
  `InstalledApp`, `Scope`) and the `MarketplaceInputs` and `MarketplaceOutputs` types.
- `@shopnex/marketplace-sdk/session-token`: `verifySessionToken` and `decodeSessionToken` for apps, `signSessionToken`
  for instances.
- `@shopnex/marketplace-sdk/payments`: payments-app request types, `verifyPaymentsRequest` for apps and
  `signPaymentsRequest` for instances.
- `@shopnex/marketplace-sdk/shipping`: carrier-service rate request types, `verifyRatesRequest` for apps and
  `signRatesRequest` for instances.
- `@shopnex/marketplace-sdk/keys`: Ed25519 key pairs (`generateKeyPair`), JWTs, client assertions and
  `createJwksResolver`.

## Documentation

See [Apps and marketplace](https://github.com/shopnex-ai/shopnex/blob/main/docs/apps.md) for how apps, instances and
the marketplace fit together, and the
[Authentication guide](https://github.com/shopnex-ai/shopnex/blob/main/apps/docs/content/docs/apps/authentication.mdx)
for keys and tokens.
