import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { createProcedures } from '@shopnex/rpc'
import * as storeImportService from './store-import'
import { storeImportInput, storeImportOutput, storeImportOverview } from './store-import.contract'

const { shopManager } = createProcedures()

// Importing a store writes products, pages, menus and (for a new shop) the theme: shop owners and admins, from a session.
// An API token cannot start one.
export const storeImport = {
  overview: shopManager
    .route({ method: 'GET', path: '/admin/store-import' })
    .output(storeImportOverview)
    .handler(async ({ context }) => ({
      fresh: await storeImportService.isFresh(context.shop.id, db),
      latest: await storeImportService.latest(context.shop.id, db),
    })),
  start: shopManager
    .route({ method: 'POST', path: '/admin/store-import' })
    .input(storeImportInput)
    .output(storeImportOutput)
    .handler(({ input, context }) => storeImportService.start(context.shop.id, input, db)),
  get: shopManager
    .route({ method: 'GET', path: '/admin/store-import/{id}' })
    .input(z.object({ id: z.uuid() }))
    .output(storeImportOutput)
    .handler(async ({ input, context }) => {
      const row = await storeImportService.get(context.shop.id, input.id, db)
      if (!row) throw new ORPCError('NOT_FOUND')
      return row
    }),
}
