// The shapes of this module's API: what the admin routes answer. Plain Zod, no oRPC or server code.
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import { marketplaceThemes, shopThemes, type StoredThemeDocument, type ThemeRole } from './theme.schema'

const themeRole = z.enum(['live', 'unpublished']) satisfies z.ZodType<ThemeRole>
const themeDocument = z.custom<StoredThemeDocument>()
const themeRow = createSelectSchema(shopThemes, { role: themeRole }).omit({ files: true })
export const themeSummaryOutput = themeRow
  .omit({ shopId: true, draft: true, published: true, filesVersion: true })
  .extend({ unpublishedChanges: z.boolean() })
export const themeRowOutput = themeRow.omit({ shopId: true, draft: true, published: true }).nullable()
export const themeDetailOutput = themeRow.extend({ draft: themeDocument, published: themeDocument.nullable() })
export const themeFilesOutput = z.object({
  original: z.record(z.string(), z.string()),
  edited: z.record(z.string(), z.string()),
  changed: z.array(z.string()),
  rev: z.number().int(),
})
export const revOutput = z.object({ rev: z.number().int() })
export const themePublishCodeOutput = z.union([
  z.object({ published: z.literal(false), rev: z.number().int(), value: z.undefined().optional() }),
  z.object({ published: z.literal(true), rev: z.number().int(), value: z.void() }),
])
export const themeStoreOutput = z.array(
  createSelectSchema(marketplaceThemes)
    .pick({
      id: true,
      name: true,
      tagline: true,
      description: true,
      developerName: true,
      baseThemeId: true,
      screenshotUrl: true,
      updatedAt: true,
    })
    .extend({ listingUrl: z.string() }),
)
export const idOutput = z.object({ id: z.string() })
export const updatedAtOutput = z.object({ updatedAt: z.date() })
export const publishedAtOutput = z.object({ publishedAt: z.date() })
export const themeDraftOutput = z.object({ draft: themeDocument, updatedAt: z.date() })
export const previewTokenOutput = z.object({ token: z.string(), expiresAt: z.date() })
