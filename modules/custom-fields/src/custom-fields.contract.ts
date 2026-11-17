// The shapes of this module's API: what the admin routes accept and answer. Plain Zod, no oRPC or server code, so the
// admin UI uses the same schemas for its forms (re-exported by @shopnex/api/schemas).
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  CUSTOM_FIELD_KEY_PATTERN,
  CUSTOM_FIELD_RESOURCES,
  CUSTOM_FIELD_TYPES,
  customFieldDefinitions,
} from './custom-fields.schema'

export const customFieldInput = z.object({
  resource: z.enum(CUSTOM_FIELD_RESOURCES),
  // How themes and APIs address the field, e.g. `material` → product.custom_fields.material. Fixed once created.
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(CUSTOM_FIELD_KEY_PATTERN, 'Use lowercase letters, digits and underscores, starting with a letter'),
  label: z.string().trim().min(1).max(100),
  // Fixed once created
  type: z.enum(CUSTOM_FIELD_TYPES),
  // The choices of a `choice` field (and only of it)
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  // Show the value in themes and the Storefront API (otherwise it stays in the admin, Admin API and apps)
  storefront: z.boolean().optional(),
})

export const customFieldPatch = customFieldInput
  .pick({ label: true, storefront: true, options: true })
  .extend({ position: z.number().int().min(0).max(1000) })
  .partial()

export const customFieldOutput = createSelectSchema(customFieldDefinitions, {
  resource: z.enum(CUSTOM_FIELD_RESOURCES),
  type: z.enum(CUSTOM_FIELD_TYPES),
})

// What a record stores for its custom fields, by key
export const customFieldValues = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))

// What a create / update sends: a value sets the field, null clears it, keys left out stay as they are
export const customFieldUpdates = z
  .record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
  .describe('Custom field values by key; null clears a field. Keys must be defined under Settings → Custom fields.')
