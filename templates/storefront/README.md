# Shopnex storefront

The storefront that ships with Shopnex: one Astro app that renders whichever theme the shop uses. Merchants pick
and customize themes in the admin (Online store → Themes); nothing here needs editing to run a shop.

```bash
pnpm dev                      # from the repo root: Shopnex on :3000 + this storefront on :4321
pnpm --dir templates/storefront dev   # on its own (copy .env.example to .env)
pnpm --dir templates/storefront build # themes' assets, then the server (node dist/server/entry.mjs, from this folder)
```

## How it works

- Themes are **Liquid templates** (LiquidJS, Shopify's template language), not code: the server never runs a
  theme's JavaScript, so a theme can come from anyone. Templates are HTML-escaped by default, read files only
  from their own folder, and are time- and memory-limited (`src/core/liquid.ts`).
- Every request asks Shopnex which theme is live (`storefront.theme.current`) and renders that theme's template
  for the route with the merchant's settings, inside its layout. In the theme editor's preview, it renders the
  draft instead.
- Routes (`src/pages`) load the data and are the same for every theme: `/`, `/products`, `/collections/{handle}`, `/search`,
  `/products/{handle}`, `/pages/{handle}`, and the 404 page.
- The cart runs in the browser against the Storefront API (`@shopnex/storefront-sdk/cart`); checkout is
  Shopnex's hosted page.
- `/shopnex/theme.json` lists the themes' definitions, so the admin can offer them and edit their settings.

```
src/
  core/      theme loading and rendering (theme.ts), the Liquid engine (liquid.ts), the objects templates see
             (drops.ts), Shopnex client, catalog, links
  pages/     routes (data → the active theme's template), theme assets, /shopnex/theme.json
  runtime/   the storefront's own browser script (the editor preview connector)
scripts/     themes.mjs builds themes' CSS and scripts; dev.mjs runs it in watch mode beside astro dev
themes/
  index.json           the included themes; the first is the default
  storeplate/          the default theme; its cart is a React island
  maison/              a printed, editorial theme (serif type, hairline rules); plain scripts, no islands
  shopco/              a bold fashion store (wide uppercase type, pill buttons, rounded cards); plain scripts
  hydrogen/            a quiet store in Shopify Hydrogen's style (system type, 4:5 photos, sticky gallery); plain scripts
```

## A theme

```
themes/<id>/
  theme.json             ThemeDefinition: settings, section types and their settings, default pages, styles.
                         `id` must match the folder and stay stable: shops' customizations are stored under it.
  layout/theme.liquid    every page: {{ content_for_header }} in <head>, {{ content_for_layout }} in <body>
  templates/             index, collection (/products and /collections/{handle}), product, page, 404
  sections/<type>.liquid one per section type in theme.json
  snippets/              for {% render 'name' %}
  assets/                served at /shopnex/assets/<id>/…, linked with {{ 'file' | asset_url }}
  src/theme.css          → assets/theme.css (Tailwind, scanning the theme's folder)
  src/theme.ts           → assets/theme.js (esbuild: TypeScript, npm packages, React islands)
```

Add the folder to `themes/index.json`. `pnpm dev` rebuilds `assets/theme.css` and `assets/theme.js` on change
(they're build output, not committed); templates and `theme.json` are read on every request in dev.

### What templates see

Names follow Shopify's Liquid, so Shopify theme developers feel at home (`src/core/drops.ts` has them all):

- Everywhere: `shop`, `settings` (the theme's), `collections` (by handle too, and `collections.all`),
  `linklists['main-menu'].links`, `request` (`path`, `page_type`, `design_mode` in the editor), `template`,
  `page_title`, `page_description`, `page_image`. A template can `{% assign page_title = … %}` for the layout.
- `product` (and `recommendations.products`), `collection` (with `sort_options`, `filters`, `active_filters`,
  `clear_filters_url` and `paginate` on catalog pages; `search` (`performed`, `terms`) on `/search`), `page`, in their templates. `section` (`id`, `type`, `settings`) in sections; `{% sections 'home' %}`
  renders a page's sections in the merchant's order.
- Settings arrive ready to use: `collection` settings are the collection, `url` and `image` settings only safe
  URLs, `code` settings output as is.
- `{{ product | json }}` is the Storefront API's shape (`@shopnex/storefront-sdk` types), for scripts.

Differences from Shopify: output is HTML-escaped (`| raw` opts out; admin HTML such as `product.description`
outputs as is), prices are objects that `| money` formats in their own currency, and `{% capture %}` output
isn't escaped twice.

### Scripts

Theme scripts use `@shopnex/storefront-sdk/cart` (the cart as nanostores, add to cart, line quantities) and
`@shopnex/storefront-sdk/money`. Server-render what you can in Liquid and enhance it; for parts that only exist
in the browser, Storeplate mounts React islands into `<div data-island="Name" data-props='{…}'>`
(`themes/storeplate/src/islands.ts`).

## Credits

The Storeplate theme is adapted from [Storeplate](https://github.com/zeon-studio/storeplate) by Zeon Studio (MIT).
The Maison theme is adapted from [Maison](https://github.com/njbSaab/astro-njx-maison) by njxui.dev (MIT).
The Shopco theme's design is based on the SHOP.CO e-commerce website kit from the Figma Community by
TODO-creator-name (TODO-figma-community-link), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); its
markup and code are new. Product photos and brand logos from the kit aren't included.
The Hydrogen theme is a port of [hydrogen-theme](https://github.com/montalvomiguelo/hydrogen-theme) by Miguel
Montalvo (MIT), itself a port of Shopify Hydrogen's default template, from Shopify OS 2.0 to Shopnex's Liquid.
