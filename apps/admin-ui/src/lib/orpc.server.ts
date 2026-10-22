import { getRequest } from '@tanstack/react-start/server'
import { createRouterClient } from '@orpc/server'
import { createContext, router } from '@shopnex/api'

// Request-scoped API client for TanStack server functions and loaders.
export const serverClient = createRouterClient(router, {
  context: async () => createContext(getRequest().headers),
})
