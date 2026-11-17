// What content does when another module says something happened. Loaded by the package entry and the manifest, so any process that
// can create a shop through the API has it (modules/content/tests/menus.test.ts creates one through tenancy).
import { shopCreated } from '@shopnex/tenancy'
import { seedDefault } from './menus'

// A new shop gets working navigation from the first visit
shopCreated.on('content.menus', (conn, { shopId }) => seedDefault(conn, shopId))
