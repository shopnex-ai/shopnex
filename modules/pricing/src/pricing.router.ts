import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { createProcedures } from '@shopnex/rpc'
import * as discountService from './discounts'
import { discountCreateInput, discountInput, discountOutput, taxRateInput, taxRateOutput } from './pricing.contract'
import * as taxService from './taxes'

const { scoped, shopManager } = createProcedures()

const id = z.object({ id: z.uuid() })
const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

const read = scoped('read_discounts')
const write = scoped('write_discounts')

// Discount codes buyers enter at checkout (one per order)
export const discounts = {
  deleteMany: write
    .route({ method: 'DELETE', path: '/admin/discounts/bulk' })
    .output(z.number().int())
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .handler(({ input, context }) => discountService.removeMany(context.shop.id, input.ids, db)),

  list: read
    .route({ method: 'GET', path: '/admin/discounts' })
    .output(z.array(discountOutput))
    .handler(({ context }) => discountService.list(context.shop.id, db)),
  get: read
    .route({ method: 'GET', path: '/admin/discounts/{id}' })
    .output(discountOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await discountService.getById(context.shop.id, input.id, db))),
  create: write
    .route({ method: 'POST', path: '/admin/discounts' })
    .output(discountOutput)
    .input(discountCreateInput)
    .handler(({ input, context }) => discountService.create(context.shop.id, input, db)),
  update: write
    .route({ method: 'PATCH', path: '/admin/discounts/{id}' })
    .output(discountOutput)
    .input(id.extend(discountInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await discountService.update(context.shop.id, id, patch, db)),
    ),
  delete: write
    .route({ method: 'DELETE', path: '/admin/discounts/{id}' })
    .output(discountOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await discountService.remove(context.shop.id, input.id, db))),
}

// Settings → Taxes: rates by country / province (whether prices include tax is on the shop)
export const taxRates = {
  list: shopManager
    .route({ method: 'GET', path: '/admin/tax-rates' })
    .output(z.array(taxRateOutput))
    .handler(({ context }) => taxService.list(context.shop.id, db)),
  create: shopManager
    .route({ method: 'POST', path: '/admin/tax-rates' })
    .output(taxRateOutput)
    .input(taxRateInput)
    .handler(({ input, context }) => taxService.create(context.shop.id, input, db)),
  update: shopManager
    .route({ method: 'PATCH', path: '/admin/tax-rates/{id}' })
    .output(taxRateOutput)
    .input(id.extend(taxRateInput.partial().shape))
    .handler(async ({ input: { id, ...patch }, context }) =>
      found(await taxService.update(context.shop.id, id, patch, db)),
    ),
  delete: shopManager
    .route({ method: 'DELETE', path: '/admin/tax-rates/{id}' })
    .output(taxRateOutput)
    .input(id)
    .handler(async ({ input, context }) => found(await taxService.remove(context.shop.id, input.id, db))),
}
