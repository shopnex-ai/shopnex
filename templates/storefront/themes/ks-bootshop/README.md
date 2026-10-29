# KS BootShop for Shopnex

[KS BootShop](https://github.com/kondasoft/ks-bootshop) (KondaSoft, MIT) ported to Shopnex's Liquid themes: a clean
storefront on [Bootstrap](https://getbootstrap.com/) 5, with no JavaScript framework.

- Home page sections: hero carousel, featured products, featured collections, media with text, rich text,
  testimonials, FAQ, custom HTML
- Product page with option pickers, gallery and structured data; catalog pages with sorting and paging
- Cart drawer on the Storefront API, announcement bar, main and footer menus from Online store → Navigation
- Theme settings: primary, background and text colors, heading and body fonts, corner radius, custom CSS and
  head code. Three styles: BootShop, Ocean, Forest.

See [Writing a theme](../../../../apps/docs/content/docs/storefronts/themes.mdx) for the folder layout.

## What differs from the Shopify theme

The Shopify theme's Liquid depends on Shopify's server (JSON templates, `{% schema %}`, `section.blocks`, `t`
translations, Shopify's cart and search). Shopnex themes describe their settings in `theme.json` and render
with its own objects, so the templates, sections and snippets were rewritten; the Bootstrap build is the same.

- `assets/vendor-bootstrap.min.css` and `vendor-bootstrap.bundle.min.js`: Bootstrap 5.3 as shipped with the Shopify
  theme (custom spacing scale and breakpoints), so `assets/shopnex.css` restores the standard spacing utilities and
  holds the theme's own styles.
- `src/*.ts` → `assets/theme.js` (built by `pnpm dev` / `pnpm build`): cart drawer and option pickers.
- Not ported: blog, search, customer accounts, gift cards, password page, localization, product ratings.
