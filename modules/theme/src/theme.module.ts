import { defineModule } from '@shopnex/kit'
import { themes } from './theme.router'
import { marketplaceThemes, shopThemes } from './theme.schema'

export const themeModule = defineModule({
  name: 'theme',
  dependsOn: ['core', 'db', 'drafts', 'rpc', 'storefront-sdk'],
  tables: { shopThemes, marketplaceThemes },
  router: themes,
})
