import { defineServices } from '@shopnex/kit'
import * as menus from './menus'
import * as pages from './pages'

// `content.menus.list(shopId)` on the shared connection; `content.withConn(tx).menus.list(shopId)` inside a transaction
export const content = defineServices({ menus, pages })
