import { defineModule } from '@shopnex/kit'
import './content.hooks'
import { menus as menuRoutes, pages as pageRoutes } from './content.router'
import { menus, pages } from './content.schema'

export const contentModule = defineModule({
  name: 'content',
  dependsOn: ['catalog', 'db', 'rpc', 'tenancy'],
  tables: { menus, pages },
  router: { menus: menuRoutes, pages: pageRoutes },
})
