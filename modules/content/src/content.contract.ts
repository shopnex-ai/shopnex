// The shapes of this module's API: what the Online store → Navigation and Pages routes take and answer. Plain Zod, no oRPC or server
// code.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { SLUG_PATTERN } from '@shopnex/core/slug'
import { MENU_ITEM_TYPES, menus, pages, type StoredMenuItem } from './content.schema'

// The same handle and search engine fields as products and collections have in the api schemas (written out here until catalog is a
// module and this one can import them from it)
const slug = z.string().min(1).max(120).regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens')
const seoInput = z.object({
  title: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
})

// Online store → Navigation. Items nest up to 3 levels (MENU_MAX_DEPTH), each level built from the one below.
// collection / product / page items need a resourceId, http items a url; fields that don't apply are cleared.
const menuItemFields = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().trim().min(1, 'Enter a name').max(255),
  type: z.enum(MENU_ITEM_TYPES),
  resourceId: z.uuid().nullish(),
  // Relative path, #anchor, http(s), mailto: or tel: (never javascript:)
  url: z
    .string()
    .trim()
    .max(2000)
    .regex(/^(\/|#|https?:\/\/|mailto:|tel:)/i, 'Use a path like /about, or a full https:// address')
    .nullish(),
})

const linksResource = (type: string) => type === 'collection' || type === 'product' || type === 'page'

const menuItem = <T extends z.ZodType>(children: T) =>
  menuItemFields
    .extend({ items: children })
    .superRefine((item, ctx) => {
      if (linksResource(item.type) && !item.resourceId) {
        ctx.addIssue({ code: 'custom', path: ['resourceId'], message: `Choose a ${item.type}` })
      }
      if (item.type === 'http' && !item.url) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Enter a link' })
      }
    })
    .transform((item) => ({
      ...item,
      resourceId: linksResource(item.type) ? (item.resourceId ?? null) : null,
      url: item.type === 'http' ? (item.url ?? null) : null,
    }))

// Typed like the stored tree (recursive), but the third level can't have sub-items
const menuItemLevel3 = menuItem(
  z.array(z.custom<StoredMenuItem>()).max(0, 'Menus nest 3 levels deep at most').default([]),
)
const menuItemLevel2 = menuItem(z.array(menuItemLevel3).max(50).default([]))
const menuItemLevel1 = menuItem(z.array(menuItemLevel2).max(50).default([]))

export const menuInput = z.object({
  handle: z
    .string()
    .trim()
    .min(1, 'Enter a handle')
    .max(100)
    .regex(SLUG_PATTERN, 'Use lowercase letters, digits and single hyphens'),
  title: z.string().trim().min(1, 'Enter a name').max(100),
  items: z.array(menuItemLevel1).max(50).default([]),
})

// Online store → Pages. The handle is generated from the title when omitted.
export const pageInput = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(255),
  handle: slug.optional(),
  bodyHtml: z.string().max(500_000).optional(),
  seo: seoInput.optional(),
  published: z.boolean().optional(),
})

export const pageOutput = createSelectSchema(pages)
export const menuOutput = createSelectSchema(menus).extend({ items: z.custom<StoredMenuItem[]>() })
