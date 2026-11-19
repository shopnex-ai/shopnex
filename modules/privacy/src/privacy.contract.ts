// The shapes of this module's API: what the customer data export and erase routes answer. Plain Zod, no oRPC or server code.
import { z } from 'zod'
import { customFieldValues } from '@shopnex/custom-fields/contract'

// What the shop holds about one customer (Privacy → export). The orders, carts and emails are plain records: they are a
// document for a person to read, not a contract for code, and they grow with the data model
const record = z.record(z.string(), z.unknown())
export const customerExportOutput = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.date(),
  customer: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    customFields: customFieldValues,
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  loginAccount: z
    .object({
      name: z.string(),
      email: z.string(),
      emailVerified: z.boolean(),
      createdAt: z.date(),
      sessions: z.array(record),
    })
    .nullable(),
  orders: z.array(record),
  carts: z.array(record),
  emails: z.array(record),
  unsubscribedFromReminders: z.boolean(),
})

// What an erasure did, in counts (no personal data)
export const customerEraseOutput = z.object({
  ordersAnonymized: z.number().int(),
  cartsCleared: z.number().int(),
  emailsRedacted: z.number().int(),
  webhookDeliveriesDeleted: z.number().int(),
  loginAccountDeleted: z.boolean(),
})

// customer.erased: names the customer so a receiver can find and delete its own copy
export const customerErasedOutput = z.object({ id: z.uuid(), email: z.string() })
