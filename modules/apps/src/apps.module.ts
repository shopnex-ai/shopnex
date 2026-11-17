import { defineModule } from '@shopnex/kit'
import './apps.hooks'
import { appData, appRegistry, apps, marketplace, marketplaceConnection, oauth } from './apps.router'
import {
  appAuthorizationCodes,
  appData as appDataTable,
  appInstallations,
  instanceKeys,
  marketplaceConnection as marketplaceConnectionTable,
} from './apps.schema'

export const appsModule = defineModule({
  name: 'apps',
  dependsOn: ['db', 'marketplace-sdk', 'rpc', 'storefront-sdk', 'tenancy', 'theme'],
  tables: {
    appInstallations,
    appAuthorizationCodes,
    appData: appDataTable,
    instanceKeys,
    marketplaceConnection: marketplaceConnectionTable,
  },
  router: { apps, appRegistry, appData, marketplaceConnection, oauth, marketplace },
})
