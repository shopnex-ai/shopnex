// @ts-check
import node from '@astrojs/node'
import { defineConfig } from 'astro/config'

export default defineConfig({
  // Rendered per request: the theme and its settings come from Shopnex (Online store → Themes) and products
  // appear without a rebuild. `node dist/server/entry.mjs` serves the build (from this folder: it reads themes/).
  // Themes' CSS and scripts are built by scripts/themes.mjs, not Vite.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
})
