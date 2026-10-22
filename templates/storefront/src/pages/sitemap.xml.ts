// /sitemap.xml: every page search engines should find (home, catalog, collections, products, pages), with
// when it last changed. One file: the sitemap protocol allows 50,000 addresses, far beyond a typical shop.
import type { APIRoute } from 'astro'
import type { PageInfo } from '@shopnex/storefront-sdk'
import { shopnex } from '../core/shopnex'

const MAX_URLS = 50_000

/** Every node of a Storefront API list, 100 at a time */
async function all<T>(list: (after?: string) => Promise<{ nodes: T[]; pageInfo: PageInfo }>, limit: number) {
  const nodes: T[] = []
  let after: string | undefined
  while (nodes.length < limit) {
    const page = await list(after)
    nodes.push(...page.nodes)
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break
    after = page.pageInfo.endCursor
  }
  return nodes.slice(0, limit)
}

const xml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export const GET: APIRoute = async ({ url }) => {
  const first = 100
  const [collections, pages] = await Promise.all([
    all((after) => shopnex.collections.list({ first, after }), MAX_URLS),
    all((after) => shopnex.pages.list({ first, after }), MAX_URLS),
  ])
  const products = await all(
    (after) => shopnex.products.list({ first, after }),
    MAX_URLS - 2 - collections.length - pages.length,
  )

  const entries: { path: string; lastmod?: string }[] = [
    { path: '/' },
    { path: '/products' },
    ...collections.map((c) => ({ path: `/collections/${encodeURIComponent(c.handle)}`, lastmod: c.updatedAt })),
    ...products.map((p) => ({ path: `/products/${encodeURIComponent(p.handle)}`, lastmod: p.updatedAt })),
    ...pages.map((p) => ({ path: `/pages/${encodeURIComponent(p.handle)}`, lastmod: p.updatedAt })),
  ]
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(
      (e) => `<url><loc>${xml(url.origin + e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`,
    ),
    '</urlset>',
  ].join('\n')

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
