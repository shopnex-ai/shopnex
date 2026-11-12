import { queryOptions } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { getAdminContext } from '@/lib/session.functions'
import { orpc, type Outputs } from '@/lib/orpc'
import { getInstalledApps } from '@/screens/apps/functions'

const queryKey = ['admin-context']

// The /admin layout re-runs beforeLoad on every navigation under it; caching the context here keeps
// sidebar clicks from waiting on a server round trip each time.
export const adminContextQuery = queryOptions({ queryKey, queryFn: () => getAdminContext(), staleTime: 30_000 })

// Call right after anything that changes who is signed in or what they can see (sign in/out, setup,
// accepting an invite, renaming the shop), before navigating, so the next beforeLoad refetches.
export function clearAdminContext(router: AnyRouter) {
  router.options.context.queryClient.removeQueries({ queryKey })
}

// The installed apps the sidebar lists. Same key as `orpc.admin.apps.list`, so installing or uninstalling (which
// invalidate `orpc.admin.apps.key()`) refreshes it, and the sidebar finds it already loaded instead of fetching
// after the page shows (the list popped in on every full page load). The server function is used because the
// oRPC client only works in the browser.
export const installedAppsQuery = queryOptions({
  queryKey: orpc.admin.apps.list.queryKey(),
  queryFn: () => getInstalledApps() as Promise<Outputs['admin']['apps']['list']>,
})
