# @shopnex/storefront-sdk

## Unreleased (additive)

- The theme definition has `removed` (paths of settings, sections and blocks dropped on purpose), and `themeStructure(definition)` and
  `unaccountedRemovals(previous, definition)` list what a theme declares and what it lost without saying why. The pull request check
  (`theme-compat`) uses them: a removal needs the `breaking-theme-change` label and a SQL migration for what merchants saved.
- `resolveDocument(definition, document)` and `resolveGlobalSections(definition, stored?)`: a stored document completed with the
  global sections the theme lists (`pages.static`) and the document lacks, with the theme's defaults, so a document saved before the
  footer became editable still has one. Everything the merchant saved is kept; resolving again changes nothing. The storefront
  and the theme editor both use it, so the editor's Footer group shows for older themes too.
- `applyPreset` no longer resets the merchant's other settings: applying a style used to rebuild every setting from the style and the defaults, which emptied
  the logo, the announcement text and the social links. Now only the settings that styles set (colors, fonts…) change.
- A global section's definition can say `group: 'footer'`: the theme editor lists it in a Footer group below the page's sections
  (the others stay in the Header group above them).
- Theme preview (`connectThemePreview`): the editor's preview is for editing, not shopping. Links, `data-add-to-cart` and
  `data-line-qty` buttons, submit buttons and form submits do nothing in it (`PREVIEW_BLOCKED_SELECTOR`); a click on a
  section still picks it, and carousels, tabs and menu toggles still work.
- `@shopnex/storefront-sdk/i18n` (browser-safe, dependency-free): a theme's text in the visitor's language. `t(key, vars?)` for
  theme scripts (reads the strings the page embeds in `<script id="shopnex-i18n">`, same `{{ placeholders }}` and plural forms as
  the `t` Liquid filter), and `flattenMessages`, `formatMessage` and `languageChain` for storefronts that load locale files themselves.
- Languages: `shop.get()` also returns `languages`, the other languages the shop publishes (`languageCode` stays the shop's own).
  Send one in the `x-shopnex-language` header (`LANGUAGE_HEADER`), or pass `language` to `createStorefrontClient`, and
  products, collections and pages come back with their translated text (`title`, `description`, `descriptionHtml`; pages:
  `title`, `body`, `bodySummary`), field by field with the shop's own text as the fallback. An unpublished or invalid
  language is ignored. A product's options are translated like Shopify's (the option's name and each value); its variants'
  `selectedOptions` and `title` are made of the translated ones. ≠ Shopify: a header for the whole request instead of
  `@inContext(language:)` on each query.
- Customer accounts (`customer.*`, `/storefront/customer/…`): `requestCode` emails a sign-in code, `signIn` checks it and
  returns a `token` (a first sign-in creates the account; guest orders with the same email join it), `signOut`,
  `get`, `update`, `orders` (cursor-paged) and `order` (the signed-in customer's own orders, with items, totals,
  tracking and address). Send the token in the `x-shopnex-customer-token` header (`CUSTOMER_TOKEN_HEADER`), or
  pass `customerToken` to `createStorefrontClient`. New typed errors: `UNAUTHORIZED`, `INVALID_CODE`,
  `TOO_MANY_REQUESTS`, `CUSTOMER_LOGIN_UNAVAILABLE` (the shop sends no email). New schemas: `Customer`,
  `CustomerOrder`, `OrderLine`, `OrderFulfillment`, `OrderAddress`. ≠ Shopify: no separate Customer Account API or OAuth.
- `products.list` filters (`GET /storefront/products`): `query` (title, vendor, product type, tags or a variant's
  SKU, case-insensitive substring), `vendor[]`, `productType[]`, `tag[]` (any of the values), `minPrice` /
  `maxPrice` (minor units; some variant within the range) and `available` (some variant can be bought).
  Filters combine with `collection` and `sortKey`.
- `products.facets` (`GET /storefront/products/facets`): the vendors, product types and tags (with product
  counts) and the price range of the products matching `collection` / `query`, for building filter UIs.
- `@shopnex/storefront-sdk/cart` (browser; small: no zod/oRPC, only nanostores): the buyer's cart for theme
  scripts. `$cart`, `$cartReady`, `$cartOpen`, `$cartError` stores, `loadCart`, `addToCart`, `setLineQuantity`,
  `reportCartError`; the cart id stays in localStorage. Reads the Storefront API's URL and publishable key from
  the page's `shopnex-url` / `shopnex-key` meta tags. New dependency: `nanostores`.
- `@shopnex/storefront-sdk/money` (dependency-free): `formatMoney` ("$19.99") and `moneyAmount` ("19.99").
- `@shopnex/storefront-sdk/theme`: `withoutCodeSettings(definition, document)`, a document from someone else
  (a marketplace theme style) with only the settings and sections the definition knows, minus `code` settings.
- `theme.current` (`GET /storefront/theme`): for storefronts with several themes, which theme to render
  (`themeId`) and the merchant's document for it: the shop's live theme, or the copy being edited with a preview
  token. A shop keeps a library of theme copies with one live. `theme.get` now returns a document only when the
  live theme is a copy of the requested theme. `@shopnex/storefront-sdk/theme`: `ThemeManifest`
  (`{ themes: ThemeDefinition[] }`, served at `THEME_DEFINITION_PATH` by multi-theme storefronts) and
  `parseThemeManifest`, which also accepts a single `ThemeDefinition`.
- `pages.list` / `pages.getByHandle` (`GET /storefront/pages`, `/storefront/pages/{handle}`): content pages from
  the admin (Online store → Pages), Shopify-style `body` (sanitized HTML) and `bodySummary`. Hidden pages aren't
  returned. Menu items can link to pages (`type: 'page'`, `url: /pages/{handle}`). New schema: `Page`.
- `menu.get` (`GET /storefront/menus/{handle}`): a navigation menu from the admin (Online store → Navigation),
  Shopify-style. Items nest 3 levels; `url` uses Shopify's paths (`/collections/{handle}`, `/products/{handle}`…)
  and items carry the linked `handle`. Links to deleted collections or unavailable products are left out.
  New schemas: `Menu`, `MenuItem`, `MenuItemType`.
- `theme.get` (`GET /storefront/themes/{themeId}`): the merchant's published theme document (or the draft,
  with the editor's preview token). `@shopnex/storefront-sdk/theme`: the theme editor format (`ThemeDefinition`,
  `ThemeDocument`) and helpers (`resolveSettings`, `defaultDocument`). Setting field types: text, textarea, url,
  image, color, checkbox, range, select, collection, and `code` (raw HTML or CSS, `language: 'html' | 'css'`).
  Styles: `ThemeDefinition.presets` (`ThemePreset`: ready-made settings, optionally pages), the document's
  optional `preset`, and `applyPreset` (changes only the settings styles set, keeps the rest and the pages a preset doesn't define).
- `@shopnex/storefront-sdk/theme-preview` (dependency-free, also re-exported from `/theme`): the editor's
  preview protocol (`ThemeEditorMessage`, `ThemePreviewMessage`, guards) and `connectThemePreview`, the
  storefront side of it for any framework.
- `checkout.options` (`GET /storefront/carts/{cartId}/checkout-options`): shipping rates priced for the cart
  (free-shipping thresholds applied) and the shop's payment methods. New schemas: `ShippingRate`,
  `PaymentMethod`, `CheckoutOptions`, `MailingAddressInput`.
- `checkout.complete` takes optional `phone`, `shippingAddress`, `shippingRateId`, `paymentMethodId`, `note`
  (rate and method default to the shop's first), and returns `orderNumber` (shown as "#1001").
- Contract-derived types: `StorefrontInputs` / `StorefrontOutputs` (e.g. `StorefrontOutputs['cart']['create']`).
- Missing schema types exported: `Seo`, `PriceRange`, `ProductSortKey`, `Merchandise`, `CartLineInput`,
  `CartLineUpdateInput`, `ConnectionArgs`, `Connection<T>`.
- `storefrontErrorMap` (+ `StorefrontErrorCode`): the single source for typed error codes/statuses/data.
- Re-exports `safe`, `isDefinedError`, `ORPCError` from `@orpc/client` for typed error handling.
- `@shopnex/storefront-sdk/constants`: `PUBLISHABLE_KEY_HEADER`, `API_BASE_PATH`, with no zod/oRPC dependency for small browser bundles.

## 1.0.0 — aligned with Shopify's Storefront API (2026-10)

Breaking (0.x had only internal consumers). From 1.0 on, changes are additive only.

| 0.4                                            | 1.0                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `slug` (product, collection, shop)             | `handle`                                                                            |
| `priceCents`, `compareAtPriceCents`            | `price`, `compareAtPrice`: `Money { amountMinor, currencyCode }`                    |
| product `priceCents` (lowest)                  | `priceRange { minVariantPrice, maxVariantPrice }`, `compareAtPriceRange`            |
| variant `options: { Size: "M" }`               | `selectedOptions: [{ name, value }]` (option order)                                 |
| option `values: string[]`                      | `optionValues: [{ id, name, firstSelectableVariantId }]`                            |
| `available`                                    | `availableForSale` (variant and product)                                            |
| images `{ url, alt }`                          | `Image { id, url, altText, width, height }`, plus `featuredImage`                   |
| `collectionSlugs`                              | `collectionHandles`                                                                 |
| `Shop.currency`                                | `Shop.currencyCode`                                                                 |
| default variant title `Default`                | `Default Title` (Shopify convention)                                                |
| lists return arrays                            | connections `{ nodes, pageInfo { hasNextPage, endCursor } }` with `first` / `after` |
| `products.getBySlug`, `collections.get`        | `products.getByHandle`, `collections.getByHandle`                                   |
| `carts.*` with `token`, lines keyed by variant | `cart.*` with `id`; lines have `id`, `merchandise`, `cost`                          |
| `addLines` / `updateLine` / `removeLine`       | `linesAdd` / `linesUpdate` / `linesRemove` (by line id, batch)                      |
| errors as `{ data: { code } }`                 | typed contract errors (`OUT_OF_STOCK { merchandiseId, available }`, …)              |

New: `vendor`, `productType`, `tags`, `descriptionHtml`, `seo`, variant `image`, `updatedAt`,
`sortKey` / `reverse`, cart `cost.totalAmount`, `createdAt` / `updatedAt`. Only `active` products are visible.

Deliberate differences from Shopify: integer `amountMinor` (not decimal `amount`), plain UUIDs (not `gid://`),
variants and cart lines inline (bounded), `checkout.complete` for headless checkout, cart `status`.
