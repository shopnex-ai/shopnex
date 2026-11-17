import { defineModule } from '@shopnex/kit'
import { channels, storefrontKeys as storefrontKeyRoutes } from './channels.router'
import { resourcePublications, storefrontKeys } from './channels.schema'

// The `channels` table is in @shopnex/db/schema for now (see channels.schema.ts), so it is not listed here
export const channelsModule = defineModule({
  name: 'channels',
  dependsOn: ['db', 'rpc'],
  tables: { storefrontKeys, resourcePublications },
  router: { channels, storefrontKeys: storefrontKeyRoutes },
})
