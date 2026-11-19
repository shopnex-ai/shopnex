import { db } from '@shopnex/db'
import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { hasScope } from '@shopnex/core/scopes'
import { createProcedures } from '@shopnex/rpc'
import { customerEraseOutput, customerExportOutput } from './privacy.contract'
import * as privacyService from './privacy'
import { PrivacyError } from './privacy'

const { adminOrToken, shopManager } = createProcedures()

// A customer's whole file is handed over: to owners and admins, or to an API token that can read both the customer and
// their orders (an app answering a data request)
const exporter = adminOrToken.use(({ context, next }) => {
  if (context.token) {
    for (const scope of ['read_customers', 'read_orders'] as const) {
      if (!hasScope(context.token.scopes, scope)) {
        throw new ORPCError('FORBIDDEN', { message: `This API token needs the ${scope} scope` })
      }
    }
  } else if (!context.superAdmin && context.role !== 'owner' && context.role !== 'admin') {
    throw new ORPCError('FORBIDDEN', { message: 'Requires shop owner or admin' })
  }
  return next()
})

// The customers' routes that need what orders, carts and emails hold: the api package puts them with the rest of /admin/customers
export const customers = {
  exportData: exporter
    .route({ method: 'GET', path: '/admin/customers/{id}/data-export' })
    .output(customerExportOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      const data = await privacyService.exportData(context.shop.id, input.id, db)
      if (!data) throw new ORPCError('NOT_FOUND')
      return data
    }),

  // Irreversible, so owners and admins only, never an API token
  erase: shopManager
    .route({ method: 'POST', path: '/admin/customers/{id}/erase' })
    .output(customerEraseOutput)
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ input, context }) => {
      try {
        return await privacyService.erase(context.shop.id, input.id, db)
      } catch (error) {
        if (error instanceof PrivacyError) {
          throw new ORPCError(error.code === 'CUSTOMER_NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT', {
            message: error.message,
            data: { code: error.code, ...error.data },
          })
        }
        throw error
      }
    }),
}
