import { defineModule } from '@shopnex/kit'
import { files, storageBackends } from './files.schema'
import { filesErrors, files as fileRoutes, storage as storageRoutes } from './files.router'

export const filesModule = defineModule({
  name: 'files',
  dependsOn: ['db', 'rpc', 'tenancy', 'webhooks'],
  tables: { files, storageBackends },
  errors: filesErrors,
  router: { files: fileRoutes, storage: storageRoutes },
})
