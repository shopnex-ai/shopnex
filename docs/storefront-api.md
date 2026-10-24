# Storefront API

Public API for external storefronts.

```ts
import { createStorefrontClient } from '@shopnex/storefront-sdk'

const shopnex = createStorefrontClient({
  baseUrl: 'http://localhost:3000',
  publishableKey: 'pk_…', // admin: POST /api/v1/admin/storefront-keys
})
const shop = await shopnex.shop.get() // { name, handle, currencyCode }
const { nodes, pageInfo } = await shopnex.products.list({
  first: 20,
  collection: 'summer',
  sortKey: 'PRICE',
})
const next = await shopnex.products.list({
  first: 20,
  after: pageInfo.endCursor!,
})
const product = await shopnex.products.getByHandle({
  handle: 'pocket-chronometer',
})
// product.priceRange.minVariantPrice → { amountMinor: 1250000, currencyCode: 'USD' }

// Cart → hosted checkout (prices are live until the order is placed)
const cart = await shopnex.cart.create({
  lines: [{ merchandiseId: product.variants[0].id, quantity: 1 }],
})
location.href = cart.checkoutUrl // or shopnex.checkout.complete({ cartId: cart.id, email }) for headless
```

- Contract v1 (`packages/storefront-sdk/src/contract.ts`, SDK 1.0.0) is aligned with Shopify's Storefront API 2026-10 — see the SDK's CHANGELOG for the mapping and deliberate differences. The server implements it in `modules/api/src/routers/storefront`; only contract fields are returned. Additive changes only from here.
- Checkout: `checkout.options({ cartId })` lists shipping rates (priced for the cart) and payment methods; `checkout.complete` takes contact, `shippingAddress`, `shippingRateId`, `paymentMethodId` and returns `orderNumber`. Orders follow Shopify's model: `financialStatus` + `fulfillmentStatus` + `cancelledAt`, shipping lines, transactions, fulfillments.
- Discounts and taxes: `cart.discountCodesUpdate({ cartId, discountCodes: ['SUMMER20'] })` (one code for now; unknown codes come back with `applicable: false`, as in Shopify). Carts expose `discountCodes`, `discountAllocations` and a discounted `cost.totalAmount`. `checkout.options({ cartId, shippingRateId?, countryCode?, province? })` also returns `cost` (subtotal, shipping, discount, `totalTaxAmount`, `taxesIncluded`, total) for that rate and address. `checkout.complete` refuses a code that doesn't apply (`DISCOUNT_NOT_APPLICABLE`).
- Errors are typed in the contract (`OUT_OF_STOCK { merchandiseId, available }`, `MERCHANDISE_NOT_FOUND`, `LINE_NOT_FOUND`, `CART_COMPLETED`, …).
- Only `active` products are visible to storefronts (`draft` / `archived` are admin-only).
- Shop resolution: `x-shopnex-key` header → that key's shop (invalid/revoked → 401); otherwise default shop (single) or request host (multi).
- Publishable keys are public (safe in browser code); manage them via `admin.storefrontKeys` (owner/admin/super admin).
