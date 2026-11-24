// Imports a store into the default shop of a scratch database, with the same code the admin runs (@shopnex/store-import).
//   DATABASE_URL=postgres://…/shopnex_scratch pnpm --filter @shopnex/api exec tsx scripts/import-store/import-store.ts <url> [--no-branding]
// Refuses any database not named shopnex_main or shopnex_scratch*. See README.md.
import { db } from '@shopnex/db'
import { storeImportService } from '@shopnex/store-import'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'

if (!/\/shopnex_(main|scratch)[\w-]*(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run: DATABASE_URL must point to a scratch database (shopnex_main or shopnex_scratch*)')
}
const url = process.argv[2]
if (!url) throw new Error('Give a store URL')

const job = await storeImportService.start(
  DEFAULT_SHOP_ID,
  { url, branding: !process.argv.includes('--no-branding') },
  db,
  { wait: true },
)
console.log(
  JSON.stringify(
    {
      origin: job.origin,
      platform: job.platform,
      status: job.status,
      counts: job.counts,
      error: job.error,
      problems: job.problems,
    },
    null,
    2,
  ),
)
await db.$client.end()
process.exit(job.status === 'done' ? 0 : 1)
