import { defineModule } from '@shopnex/kit'
import { account, rateLimits, session, verification } from './auth.schema'

// No router and no contract: Better Auth serves /api/auth/* itself (see index.ts)
export const authModule = defineModule({
  name: 'auth',
  dependsOn: ['db', 'tenancy'],
  tables: { session, account, verification, rateLimits },
})
