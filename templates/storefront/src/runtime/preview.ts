// /shopnex/preview.js, loaded by `{{ content_for_header }}` only inside the ShopNex theme editor's preview
// iframe: connects the page to the editor (reload in place after a save, highlight the picked section). The
// protocol is in @shopnex/storefront-sdk/theme-preview; sections carry data-section-id ({% sections %}).
// Built by scripts/themes.mjs into built/preview.js and served by src/pages/shopnex/preview.js.ts.
import { connectThemePreview } from '@shopnex/storefront-sdk/theme-preview'

const adminOrigin = document.querySelector<HTMLMetaElement>('meta[name="shopnex-admin-origin"]')?.content
if (adminOrigin) connectThemePreview({ adminOrigin })
