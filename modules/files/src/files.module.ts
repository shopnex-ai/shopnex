import { defineModule } from '@shopnex/kit'
import { files, storageBackends } from './files.schema'
import { files as fileRoutes, storage as storageRoutes } from './files.router'

export const filesModule = defineModule({
  name: 'files',
  dependsOn: ['core', 'db', 'rpc', 'tenancy', 'webhooks'],
  tables: { files, storageBackends },
  router: { files: fileRoutes, storage: storageRoutes },
})
