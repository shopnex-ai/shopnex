import { defineModule } from '@shopnex/kit'
import { apiTokens, domains, platform, shop, staff } from './tenancy.router'
import { shopDomains, shopInvitations, shopMembers } from './tenancy.schema'

export const tenancyModule = defineModule({
  name: 'tenancy',
  dependsOn: ['channels', 'content', 'core', 'db', 'languages', 'rpc', 'webhooks'],
  tables: { shopMembers, shopInvitations, shopDomains },
  router: { shop, staff, domains, apiTokens, platform },
})
