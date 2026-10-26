import type { APIRoute } from 'astro'
import { shopnex } from '../../core/shopnex'

async function all<T extends { handle: string; title: string }>(list: (args: { first: number; after?: string }) => Promise<{ nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }>) {
  const nodes: T[] = []
  let after: string | undefined
  do {
    const page = await list({ first: 100, after })
    nodes.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined
    if (!after) break
  } while (true)
  return nodes
}

// Sample routes for the theme editor's page picker. The editor previews actual catalog records.
export const GET: APIRoute = async () => {
  const [products, collections, pages] = await Promise.all([
    all((args) => shopnex.products.list(args)).catch(() => []),
    all((args) => shopnex.collections.list(args)).catch(() => []),
    all((args) => shopnex.pages.list(args)).catch(() => []),
  ])
  return new Response(JSON.stringify({
    products: products.map(({ handle, title }) => ({ handle, title })),
    collections: collections.map(({ handle, title }) => ({ handle, title })),
    pages: pages.map(({ handle, title }) => ({ handle, title })),
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } })
}
