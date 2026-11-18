// The shapes of this module's API: what the Settings → Channels and storefront key routes take and answer. Plain Zod, no oRPC
// or server code.
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { SLUG_PATTERN } from '@shopnex/core/slug'
import { CHANNEL_TYPES, channels } from './channels.schema'
import { storefrontKeys } from './channels.schema'

// Settings → Channels. The handle and type are fixed once created.
export const channelInput = z.object({
  name: z.string().trim().min(1).max(100),
  handle: z.string().min(1).max(60).regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens').optional(),
  type: z.enum(CHANNEL_TYPES).optional(),
  autoPublish: z.boolean().optional(),
})

export const channelOutput = createSelectSchema(channels, { type: z.enum(CHANNEL_TYPES) })

export const storefrontKeyInput = createInsertSchema(storefrontKeys, { name: (s) => s.min(1).max(100) })
  .pick({ name: true })
  // The channel the key reads; omitted: the Online Store
  .extend({ channelId: z.uuid().optional() })

export const storefrontKeyOutput = createSelectSchema(storefrontKeys)

/** Deleting something: `{ ok: true }` */
export const deletedOutput = z.object({ ok: z.boolean() })

// Where a product or collection is published: the full list (channels left out are unpublished). A date in the
// future schedules the publication; omitted or null publishes now (a channel that stays keeps its date).
export const publicationsInput = z.object({
  publications: z
    .array(z.object({ channelId: z.uuid(), publishAt: z.coerce.date().nullish() }))
    .max(50)
    .refine((list) => new Set(list.map((p) => p.channelId)).size === list.length, 'Each channel once'),
})

/** The channels a product or collection is on (a scheduled one has a date in the future) */
export const publicationsOutput = z.array(z.object({ channelId: z.uuid(), publishedAt: z.date() }))
