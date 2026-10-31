// /robots.txt: everything is open to search engines (theme assets too: Google renders pages with them) except
// themes' sources, search results, and sorted or filtered copies of catalog pages (the same products in another
// order or a subset); points to the sitemap
import type { APIRoute } from 'astro'

const RULES = [
  'User-agent: *',
  'Disallow: /shopnex/themes/',
  'Disallow: /search',
  ...['sort', 'q', 'vendor', 'type', 'tag', 'price_min', 'price_max', 'available'].map((p) => `Disallow: /*?*${p}=`),
]

export const GET: APIRoute = ({ url }) =>
  new Response([...RULES, '', `Sitemap: ${url.origin}/sitemap.xml`, ''].join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
