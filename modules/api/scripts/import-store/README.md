# import-store

"Paste a store address, get a ShopNex shop." The code is the `@shopnex/store-import` module (`modules/store-import`): the
admin runs it (Settings → Import a store, and the sign-up flow `/admin/signup?import=<store>`). This folder is what is left
around it:

| File              | What it does                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe.mjs`       | Detects Shopify / WooCommerce from a URL and prints a summary of the public catalog. Needs only Node, writes nothing.                              |
| `import-store.ts` | Runs the module's import into the **default shop of a scratch database** (it refuses any database not named `shopnex_main` or `shopnex_scratch*`). |

```sh
node scripts/import-store/probe.mjs allbirds.com tentree.com

export DATABASE_URL=postgres://…/shopnex_scratch   # migrated (pnpm db:migrate)
pnpm --filter @shopnex/api exec tsx scripts/import-store/import-store.ts tentree.com
```

What the module does, and its limits, are in `modules/store-import/README.md`.

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
- Every bundled theme has the same brand settings (`logo`, `logo_width`, `favicon`, six social urls), so the choice of theme does not decide what shows. The color and announcement settings differ per theme; `brand.ts` reads those from each `theme.json`.
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
