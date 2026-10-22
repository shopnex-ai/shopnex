// /robots.txt: everything is open to search engines (theme assets too: Google renders pages with them) except
// themes' sources and sorted copies of catalog pages (the same products in another order); points to the sitemap
import type { APIRoute } from 'astro'

const RULES = ['User-agent: *', 'Disallow: /shopnex/themes/', 'Disallow: /*?*sort=']

export const GET: APIRoute = ({ url }) =>
  new Response([...RULES, '', `Sitemap: ${url.origin}/sitemap.xml`, ''].join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
