import { createAuthClient } from 'better-auth/react'
import { adminClient, organizationClient } from 'better-auth/client/plugins'

// Same origin as the Next app, so no baseURL needed
export const authClient = createAuthClient({
  plugins: [organizationClient(), adminClient()],
})
