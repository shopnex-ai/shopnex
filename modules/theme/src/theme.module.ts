import { defineModule } from '@shopnex/kit'
import { themes } from './theme.router'
import { marketplaceThemes, shopThemes } from './theme.schema'

export const themeModule = defineModule({
  name: 'theme',
  dependsOn: ['db', 'drafts', 'rpc', 'storefront-sdk'],
  tables: { shopThemes, marketplaceThemes },
  router: themes,
})
