import { defineModule } from '@shopnex/kit'
import { languages } from './languages.router'
import { shopLanguages, translations } from './languages.schema'

export const languagesModule = defineModule({
  name: 'languages',
  dependsOn: ['core', 'db', 'rpc'],
  tables: { shopLanguages, translations },
  router: languages,
})
