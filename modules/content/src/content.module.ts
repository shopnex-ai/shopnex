import { defineModule } from '@shopnex/kit'
import { menus as menuRoutes, pages as pageRoutes } from './content.router'
import { menus, pages } from './content.schema'

export const contentModule = defineModule({
  name: 'content',
  dependsOn: ['catalog', 'db', 'rpc'],
  tables: { menus, pages },
  router: { menus: menuRoutes, pages: pageRoutes },
})
