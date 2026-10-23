import { queryOptions } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { getAdminContext } from '@/lib/session.functions'

const queryKey = ['admin-context']

// The /admin layout re-runs beforeLoad on every navigation under it; caching the context here keeps
// sidebar clicks from waiting on a server round trip each time.
export const adminContextQuery = queryOptions({ queryKey, queryFn: () => getAdminContext(), staleTime: 30_000 })

// Call right after anything that changes who is signed in or what they can see (sign in/out, setup,
// accepting an invite, renaming the shop), before navigating, so the next beforeLoad refetches.
export function clearAdminContext(router: AnyRouter) {
  router.options.context.queryClient.removeQueries({ queryKey })
}
