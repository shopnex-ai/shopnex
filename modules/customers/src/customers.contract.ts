// The shapes of this module's API: what the customer routes take and answer. Plain Zod, no oRPC or server code (the admin imports the input
// for form validation).
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { customFieldUpdates, customFieldValues } from '@shopnex/custom-fields/contract'
import { customers } from './customers.schema'

export const customerInput = createInsertSchema(customers, {
  email: () => z.email(),
  name: (s) => s.min(1),
  phone: (s) => s.min(1),
})
  .pick({ email: true, name: true, phone: true })
  .extend({ customFields: customFieldUpdates.optional() })

export const customerOutput = createSelectSchema(customers, { customFields: customFieldValues })
