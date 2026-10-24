// Adds backdated sample orders and customers to a shop so the dashboard analytics show realistic numbers.
//   pnpm demo:orders [--shop <id>] [--days 90] [--replace]
// --replace removes the earlier sample data (customers on @demo.shopnex.test and their orders) first.
import { db } from '@shopnex/db'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'
import { deleteDemoOrders, seedDemoOrders } from './lib/demo-orders'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const shopId = arg('shop') ?? DEFAULT_SHOP_ID
if (process.argv.includes('--replace')) {
  const removed = await deleteDemoOrders(shopId)
  console.log(`Removed ${removed} sample customers and their orders.`)
}
const { orders, customers } = await seedDemoOrders(shopId, { days: Number(arg('days') ?? 90) })
console.log(`Added ${orders} orders from ${customers} customers to shop "${shopId}".`)
await db.$client.end()
