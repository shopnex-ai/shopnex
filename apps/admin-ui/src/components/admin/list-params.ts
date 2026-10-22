import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'

// List state lives in the URL (?page=2&q=ann), so lists are linkable and survive reloads.
export function useListParams({ pageSize = 20 }: { pageSize?: number } = {}) {
  const navigate = useNavigate()
  // Shared by every list route, none of which declare these params; the router parses ?q=123 as a number
  const searchParams: Record<string, unknown> = useSearch({ strict: false })
  const get = (key: string) => (searchParams[key] == null ? '' : String(searchParams[key]))

  const page = Math.max(1, Number(get('page')) || 1)
  const search = get('q')

  const update = useCallback(
    (next: Record<string, string | number | undefined>) => {
      navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => {
          const params = { ...prev }
          for (const [key, value] of Object.entries(next)) {
            // Defaults stay out of the URL
            if (value === undefined || value === '' || (key === 'page' && value === 1)) delete params[key]
            else params[key] = value
          }
          return params
        },
        replace: true,
        resetScroll: false,
      })
    },
    [navigate],
  )

  return {
    page,
    pageSize,
    search,
    /** Ready for an admin list procedure: { limit, offset } */
    range: { limit: pageSize, offset: (page - 1) * pageSize },
    setPage: useCallback((p: number) => update({ page: p }), [update]),
    // A new search starts from the first page
    setSearch: useCallback((q: string) => update({ q, page: 1 }), [update]),
    /** Extra filter in the URL (e.g. ?status=paid); '' clears it. Changing it starts from the first page */
    filter: get,
    setFilter: useCallback((key: string, value: string) => update({ [key]: value, page: 1 }), [update]),
  }
}
