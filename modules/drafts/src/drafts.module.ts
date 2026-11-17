import { defineModule } from '@shopnex/kit'
import { entityDrafts } from './drafts.schema'

// No routes and no errors to map: drafts are written and published by the module whose entity has one (theme today)
export const draftsModule = defineModule({
  name: 'drafts',
  dependsOn: ['core', 'db'],
  tables: { entityDrafts },
})
