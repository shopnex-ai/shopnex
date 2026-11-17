import { defineModule } from '@shopnex/kit'
import './ai.hooks'
import { ai, aiAppApi, aiSettings as aiSettingsRoutes } from './ai.router'
import { aiGenerations, aiProviders, aiSettings } from './ai.schema'

export const aiModule = defineModule({
  name: 'ai',
  dependsOn: ['apps', 'catalog', 'content', 'db', 'marketplace-sdk', 'rpc', 'tenancy'],
  tables: { aiProviders, aiSettings, aiGenerations },
  router: { ai, aiSettings: aiSettingsRoutes, aiApp: aiAppApi },
})
