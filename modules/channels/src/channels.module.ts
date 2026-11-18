import { defineModule } from '@shopnex/kit'
import { channels, storefrontKeys as storefrontKeyRoutes } from './channels.router'
import { channels as channelsTable, resourcePublications, storefrontKeys } from './channels.schema'

export const channelsModule = defineModule({
  name: 'channels',
  dependsOn: ['core', 'db', 'rpc'],
  tables: { channels: channelsTable, resourcePublications, storefrontKeys },
  router: { channels, storefrontKeys: storefrontKeyRoutes },
})
