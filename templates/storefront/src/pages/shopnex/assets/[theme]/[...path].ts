// A theme's assets (themes/{id}/assets): its built stylesheet and script, images, fonts. `| asset_url` adds
// ?v={modified time}, so versioned URLs are cached for good.
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { APIRoute } from 'astro'
import { findTheme } from '../../../../core/theme'

const types: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export const GET: APIRoute = async ({ params, url }) => {
  const theme = findTheme(params.theme ?? '')
  const type = types[extname(params.path ?? '').toLowerCase()]
  if (!theme || !type || !params.path) return new Response('Not found', { status: 404 })
  const assets = join(theme.dir, 'assets')
  const file = resolve(assets, params.path)
  if (!file.startsWith(assets + sep)) return new Response('Not found', { status: 404 })
  try {
    return new Response(await readFile(file), {
      headers: {
        'content-type': type,
        'cache-control':
          url.searchParams.has('v') && !import.meta.env.DEV ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
