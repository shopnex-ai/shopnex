# import-store (experiment)

Read-only experiments for "paste a store URL, get a ShopNex shop". Nothing here is wired into the product yet.
They load into the **default shop of a scratch database**, and refuse to run on any database not named
`shopnex_main` or `shopnex_scratch*`.

| File                   | What it does                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe.mjs`            | Detects Shopify / WooCommerce from a URL and prints a summary of the public catalog. Needs only Node, writes nothing.                                                                              |
| `import-products.ts`   | Finds out the platform (Shopify or WooCommerce) and loads a sample into the default shop: products with variants, collections, the usual pages, the main and footer menus and the shop's currency. |
| `shopify.ts`, `woo.ts` | The fetchers: what each platform's public endpoints give, turned into one shape.                                                                                                                   |
| `load.ts`              | The shared part: creates the products, collections, pages, menus and currency from that shape.                                                                                                     |
| `brand.ts`             | Reads the homepage and sets the shop name, logo and primary color (a published Storeplate theme copy). `--dry` only prints.                                                                        |
| `lib.ts`               | A polite `fetch` (named user agent, pause between requests) and the scratch-database guard.                                                                                                        |

```sh
node scripts/import-store/probe.mjs allbirds.com tentree.com

export DATABASE_URL=postgres://…/shopnex_main   # a scratch database, migrated (pnpm db:migrate)
pnpm --filter @shopnex/api exec tsx scripts/import-store/import-products.ts tentree.com --max 30
pnpm --filter @shopnex/api exec tsx scripts/import-store/brand.ts tentree.com
```

## What was learned (Shopify, a few public stores)

- `/products.json` works on public stores: 250 per page, so paging is needed. The placeholder option `Title` /
  `Default Title` must be skipped. The public feed has no stock level, only available or not.
- `/collections/<handle>/products.json` rate-limits (HTTP 429) fast, so collections are made by grouping products by
  `product_type` (no extra requests). The main menu then links to them.
- `/pages.json` returns pages with their `body_html` (pages built from a theme template come back empty, and a store's
  list has junk like "test" and "old" pages), so only the usual shop pages are taken, most useful first. Scraping the
  page HTML instead does not work: `<main>` includes the whole mega menu.
- Name comes reliably from `/meta.json`. A logo is found in the header's `<img>` on about half the stores, otherwise
  the favicon (use a width of 60, the theme's minimum). The brand color is the weak part: `theme-color` is often a
  background, so only use a color the page declares or the logo clearly has, else keep the theme default.
- The default theme (ks-bootshop) shows the shop name as text only; Storeplate has a `logo` setting.
- WooCommerce, tried on 14 real stores (USD, EUR, GBP, CAD, AUD; 1 to 177,000 products): all 14 load. The Store API
  (`/wp-json/wc/store/v1`) and WordPress's `/wp-json/wp/v2/pages` are public on every one.
  - Prices are in the currency's smallest unit, which is what ShopNex stores, so they map straight over.
  - Titles and names carry HTML entities (`&#8211;`), which must be decoded.
  - A variable product lists only variation ids. One request per product,
    `?parent=<id>&type=variation&per_page=100`, returns every variation with its price. The list's attribute values
    are sometimes null ("any"); the variation's own text ("Size: Small") says them.
  - `per_page=100` returns nothing on two of the stores but `per_page=20` works: ask for small pages.
  - Categories become the collections. Currency comes from `prices.currency_code`.
  - Digital products (patterns, themes) import as products, but their download files do not come across.
  - Competition and raffle shops import as plain products; their draw mechanics do not exist in ShopNex.

## Not done

- Fonts, blog posts, policies from `/policies/<name>.json`, keeping the store's handles as slugs, and whole catalogs (the sample is capped).
- `sharp` (the logo's dominant color) is not a dependency of `@shopnex/api`; without it the color falls back to the
  page's own colors.
- One function (URL in, shop out) that the admin, the CLI and a demo backend can share.
