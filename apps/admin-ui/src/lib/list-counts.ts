import { collectionService, productService } from '@shopnex/catalog'
import { menuService, pageService } from '@shopnex/content'
import { customerService } from '@shopnex/customers'
import { db } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { discountService } from '@shopnex/pricing'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { useEffect } from 'react'
import { adminFn } from '@/lib/server-fn'

/** The lists that know how many rows they have before they load (the `countKey` of a DataTable) */
export const LIST_KEYS = ['products', 'collections', 'customers', 'discounts', 'orders', 'pages', 'menus'] as const
export type ListKey = (typeof LIST_KEYS)[number]
export type ListCounts = Partial<Record<ListKey, number>>

/** Rows a list shows at most: a count above this only needs to say "a full page" */
export const PAGE_SIZE = 20

/** The list an admin page shows, if it is one */
export const listKeyForPath = (pathname: string): ListKey | undefined =>
  ({
    '/admin/products': 'products',
    '/admin/collections': 'collections',
    '/admin/customers': 'customers',
    '/admin/discounts': 'discounts',
    '/admin/orders': 'orders',
    '/admin/online-store/pages': 'pages',
    '/admin/online-store/navigation': 'menus',
  })[pathname.replace(/\/$/, '')] as ListKey | undefined

// Counts of the lists asked for, up to PAGE_SIZE each. The page that is loading asks for its own list only; the
// layout asks for the rest after the page shows.
export const getListCounts = adminFn
  .validator((input: { keys: ListKey[] }) => ({ keys: input.keys.filter((k) => LIST_KEYS.includes(k)) }))
  .handler(async ({ data: { keys }, context: { shopId } }): Promise<ListCounts> => {
    const count: Record<ListKey, () => Promise<number>> = {
      products: () => productService.countUpTo(shopId, PAGE_SIZE, db),
      collections: async () => (await collectionService.list(shopId, { limit: PAGE_SIZE, offset: 0 }, db)).length,
      customers: () => customerService.countUpTo(shopId, PAGE_SIZE, db),
      orders: () => orderService.countUpTo(shopId, PAGE_SIZE, db),
      discounts: async () => (await discountService.list(shopId, db)).length,
      pages: async () => (await pageService.list(shopId, db)).length,
      menus: async () => (await menuService.list(shopId, db)).length,
    }
    const entries = await Promise.all(keys.map(async (key) => [key, await count[key]()] as const))
    return Object.fromEntries(entries)
  })

const listCountsKey = ['list-counts']
export const listCountsQuery = { queryKey: listCountsKey, queryFn: skipToken, staleTime: Infinity } as const

/** The known row count of a list, or undefined when it is not known (not a manager, or not loaded yet) */
export function useListCount(key: ListKey | undefined) {
  const initial = useRouteContext({
    strict: false,
    select: (context) => (context as { listCounts?: ListCounts }).listCounts,
  })
  const { data } = useQuery({ ...listCountsQuery, initialData: initial ?? {} })
  return key ? data?.[key] : undefined
}

/** After the page shows: the counts of the lists the page did not need, so the next list opened has its count */
export function useLoadOtherListCounts(enabled: boolean) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const known = queryClient.getQueryData<ListCounts>(listCountsKey) ?? {}
    const missing = LIST_KEYS.filter((key) => known[key] === undefined)
    if (missing.length === 0) return
    void getListCounts({ data: { keys: missing } }).then((counts) =>
      queryClient.setQueryData<ListCounts>(listCountsKey, (old) => ({ ...old, ...counts })),
    )
  }, [queryClient, enabled])
}
