// Adds the demo catalog (4 collections, 19 products tagged "demo") to a shop without touching what is there.
//   pnpm demo:products [--shop <id>]
// Then run demo:orders to give them sales.
import { db } from '@shopnex/db'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'
import { seedDemoCatalog } from './lib/demo-catalog'

const i = process.argv.indexOf('--shop')
const shopId = (i === -1 ? undefined : process.argv[i + 1]) ?? DEFAULT_SHOP_ID
const { collections, productIds } = await seedDemoCatalog(shopId)
console.log(`Added ${productIds.length} products in ${collections.length} collections to shop "${shopId}".`)
await db.$client.end()
