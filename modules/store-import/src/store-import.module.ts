import { defineModule } from '@shopnex/kit'
import { storeImport } from './store-import.router'
import { storeImports } from './store-import.schema'

export const storeImportModule = defineModule({
  name: 'store-import',
  dependsOn: ['catalog', 'content', 'core', 'db', 'rpc', 'theme', 'webhooks'],
  tables: { storeImports },
  router: { storeImport },
})
