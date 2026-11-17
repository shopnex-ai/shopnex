import { defineModule } from '@shopnex/kit'
import { customFieldDefinitions } from './custom-fields.schema'
import { customFieldErrors, customFields } from './custom-fields.router'

export const customFieldsModule = defineModule({
  name: 'custom-fields',
  dependsOn: ['db', 'rpc'],
  tables: { customFieldDefinitions },
  errors: customFieldErrors,
  router: customFields,
})
