// The consent runtime, loaded by `{{ content_for_header }}` on every page (except the theme editor's preview)
import type { APIRoute } from 'astro'
import { readConsentScript } from '../../core/consent-script'

export const GET: APIRoute = ({ url }) => {
  try {
    return new Response(readConsentScript(), {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control':
          url.searchParams.has('v') && !import.meta.env.DEV ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
