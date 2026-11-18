import { defineModule } from '@shopnex/kit'
import { apiTokens, apps, shops, user } from './core.schema'

// No routes and no logic: the tables everything else points at (see core.schema.ts). dependsOn stays empty on purpose.
export const coreModule = defineModule({
  name: 'core',
  dependsOn: [],
  tables: { user, shops, apps, apiTokens },
})
