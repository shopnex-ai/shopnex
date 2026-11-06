// The editor's preview connector, loaded by `{{ content_for_header }}` inside the preview iframe only
import type { APIRoute } from 'astro'
import { readPreviewScript } from '../../core/preview-script'

export const GET: APIRoute = ({ url }) => {
  try {
    return new Response(readPreviewScript(), {
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
