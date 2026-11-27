import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { NotFound } from '@/components/not-found'
import { RouteError } from '@/components/route-error'
import { isMissing } from '@/lib/not-found'
import { reloadOnPreloadError } from '@/lib/stale-chunk'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  if (typeof window !== 'undefined') reloadOnPreloadError()

  const queryClient = new QueryClient({
    defaultOptions: {
      // A record that is not there (or an id that is not valid) will not appear on the second try: show it at once, instead of
      // after three retries and several seconds of skeleton. Other failures keep React Query's default of three tries.
      queries: { retry: (failureCount, error) => !isMissing(error) && failureCount < 3 },
    },
  })

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    // A URL that matches no page, or a loader that threw notFound(): inside the admin's layout when the URL is under /admin
    defaultNotFoundComponent: () => <NotFound />,
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
