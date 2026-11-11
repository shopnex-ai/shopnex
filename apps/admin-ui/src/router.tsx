import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient()

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  // Routes under /admin that render on their own, without the sidebar and header (login, setup, welcome...)
  interface StaticDataRouteOption {
    standalone?: boolean
  }

  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
