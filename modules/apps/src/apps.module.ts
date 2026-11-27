import { defineModule } from '@shopnex/kit'
import './apps.hooks'
import {
  appData,
  appRegistry,
  apps,
  marketplace,
  marketplaceConnection,
  oauth,
  storefrontScriptsApp,
} from './apps.router'
import {
  appAuthorizationCodes,
  appData as appDataTable,
  appInstallations,
  appStorefrontScripts,
  instanceKeys,
  marketplaceConnection as marketplaceConnectionTable,
} from './apps.schema'

export const appsModule = defineModule({
  name: 'apps',
  dependsOn: ['core', 'db', 'marketplace-sdk', 'rpc', 'storefront-sdk', 'tenancy', 'theme', 'webhooks'],
  tables: {
    appInstallations,
    appAuthorizationCodes,
    appData: appDataTable,
    appStorefrontScripts,
    instanceKeys,
    marketplaceConnection: marketplaceConnectionTable,
  },
  router: { apps, appRegistry, appData, marketplaceConnection, oauth, marketplace, storefrontScriptsApp },
})
