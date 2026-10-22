// The themes' definitions for the Shopnex theme editor (a ThemeManifest; see core/theme)
import type { APIRoute } from 'astro'
import type { ThemeManifest } from '@shopnex/storefront-sdk'
import { themes } from '../../core/theme'

export const GET: APIRoute = () => {
  const manifest: ThemeManifest = { themes: themes().map((t) => t.definition) }
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/json',
      // Public by design: it only describes the themes' options
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  })
}
