import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { RouteError } from '@/components/route-error'
import { reloadOnPreloadError } from '@/lib/stale-chunk'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  if (typeof window !== 'undefined') reloadOnPreloadError()

  const queryClient = new QueryClient()

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
  })
}

declare module '@tanstack/react-router' {
  // Routes under /admin that render on their own, without the sidebar and header (login, setup, welcome...)
  interface StaticDataRouteOption {
    standalone?: boolean
    // The editors (theme, code): the sidebar is collapsed while one is open, and comes back after
    collapseSidebar?: boolean
  }

  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
