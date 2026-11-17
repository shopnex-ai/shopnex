import { defineModule } from '@shopnex/kit'
import { customFieldDefinitions } from './custom-fields.schema'
import { customFields } from './custom-fields.router'

export const customFieldsModule = defineModule({
  name: 'custom-fields',
  dependsOn: ['core', 'db', 'rpc'],
  tables: { customFieldDefinitions },
  router: customFields,
})
