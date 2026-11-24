# @shopnex/store-import

Paste the address of a Shopify or WooCommerce store, get its catalog in a shop. Used by Settings → Import a store, and by the
sign-up link `/admin/signup?import=<store address>` (sign up, the import runs into the new shop, then the shop is named).

## What it reads

Only what the store publishes, with no login and no access to the store:

- **Shopify:** `/products.json`, `/meta.json`, `/pages.json`, the home page.
- **WooCommerce:** the Store API (`/wp-json/wc/store/v1`), WordPress's `wp/v2/pages`, the home page.

## What comes across

Products with descriptions, images, options, variants, SKUs, prices and sale prices; collections (the biggest six groups of
at least two products); the main and footer menus; up to six usual pages (About, Contact, FAQ, shipping, returns, size guide,
privacy, terms, imprint, in English, German, French and Spanish); and, for a shop with no products yet or when asked, the
shop's name, logo, favicon, color, social links, currency and language (a published Storeplate copy).

## What does not

Customers, orders and discounts (use the CSV import); the theme (ShopNex uses its own Liquid format); apps; blog posts;
fonts; digital download files; the store's URLs. Stock is a placeholder (10 in stock, 0 sold out): the public feeds have no
quantity. It is a **sample**: the first 40 products.

## Rules it keeps

- **Adds, never replaces.** Products, collections and pages are added next to what the shop has. A menu is rewritten only when
  it still holds the two starter menus. A shop with products keeps its name, theme, currency and language unless the owner
  turns on "Set up my shop from this store".
- **Currency.** A shop that already sells in another currency refuses a store in a different one, so prices are not mislabeled.
- **One import per shop at a time** (a unique index), five a day per shop, three running in all. A running import that
  stops moving for ten minutes is reported as failed. Time limit eight minutes.
- **Only shop owners and admins** from a session can start one; an API token cannot.

## Fetching an address a stranger typed

`fetcher.ts` is the only code that touches the network. Every request and every redirect hop must resolve to a public address
(the webhooks module's `assertPublicHost`), only the standard ports, no credentials in the address, at most four redirects, a
body is cut at 8 MB, one request at a time with a pause. DNS rebinding between the check and the request is not covered (the
same limit as webhook endpoints).

Error messages stored on an import are written for the shop owner; an unexpected error is logged and replaced with a general
message, so nothing internal reaches the page.

## Tests

`pnpm --filter @shopnex/store-import test`: the fetcher's refusals, page selection (any input order gives the same pages), and
the whole import against an in-memory database with a fake store.
