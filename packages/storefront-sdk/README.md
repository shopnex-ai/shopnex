# @shopnex/storefront-sdk

The Shopnex Storefront SDK provides a typed client and API contract for building custom storefronts with frameworks such as Next.js and Astro. It supports accessing shop data, products, collections, carts, checkout, and theme information through the Shopnex Storefront API.

## Installation

```bash
pnpm add @shopnex/storefront-sdk
```

## Usage

Create a client and fetch shop information:

```ts
import { createStorefrontClient } from '@shopnex/storefront-sdk'

const client = createStorefrontClient({
  baseUrl: 'http://localhost:3000',
})

const shop = await client.shop.get()
console.log(shop)
```

For shops that require a publishable key, provide it when creating the client:

```ts
const client = createStorefrontClient({
  baseUrl: 'https://shop.example.com',
  publishableKey: 'pk_your_key',
})
```

The client works in browsers, Node.js, Astro, Next.js server components, and edge runtimes.

## Entry Points

- `@shopnex/storefront-sdk` — Main client, schemas, theme utilities, and typed error helpers.
- `@shopnex/storefront-sdk/contract` — Storefront API contract and input/output types.
- `@shopnex/storefront-sdk/constants` — Shared API constants.
- `@shopnex/storefront-sdk/cart` — Cart utilities.
- `@shopnex/storefront-sdk/money` — Money utilities.
- `@shopnex/storefront-sdk/theme` — Theme types and utilities.
- `@shopnex/storefront-sdk/theme-preview` — Theme preview utilities.

## Documentation

See the [Storefront API documentation](https://github.com/shopnex-ai/shopnex/blob/main/docs/storefront-api.md) for API details and usage guidance.
