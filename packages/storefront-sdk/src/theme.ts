// Theme editor format, shared by the ShopNex admin (the editor) and themes (storefront templates).
//
//   - A theme describes what can be customized in a ThemeDefinition: global settings, section types with
//     their settings, each page's default sections, and optional styles (presets). The storefront serves
//     its themes at THEME_DEFINITION_PATH (e.g. https://shop.acme.com/shopnex/theme.json): a ThemeManifest
//     listing them, or a single ThemeDefinition for a storefront with one theme.
//   - The merchant's choices are a ThemeDocument. ShopNex stores it (a draft and a published copy);
//     the storefront reads it back with `storefront.theme.current` (or `theme.get` for a single theme) and
//     renders the sections in order.
//
// Themes must cope with anything in a document: unknown section types are skipped, and settings
// go through `resolveSettings`, which falls back to the field's default for missing or invalid values.
// The editor's live preview is in ./theme-preview (also exported here).
import { z } from 'zod'

/** Where a theme serves its ThemeDefinition, relative to the storefront origin */
export const THEME_DEFINITION_PATH = '/shopnex/theme.json'
export * from './theme-preview'

const Id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'Lowercase letters, digits, - and _')
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A hex color like #8a3b32')

// ── definition (written by theme authors) ─────────────────────────────────────

const field = {
  id: Id,
  label: z.string().min(1).max(100),
  info: z.string().max(500).optional(),
  /** The editor shows neighbouring fields with the same group under one heading, e.g. "Social links" */
  group: z.string().min(1).max(60).optional(),
}

export const ThemeSettingField = z.discriminatedUnion('type', [
  z.object({ ...field, type: z.literal('text'), default: z.string().optional(), placeholder: z.string().optional() }),
  z.object({ ...field, type: z.literal('textarea'), default: z.string().optional() }),
  z.object({ ...field, type: z.literal('url'), default: z.string().optional() }),
  /** An image URL */
  z.object({ ...field, type: z.literal('image'), default: z.string().optional() }),
  z.object({ ...field, type: z.literal('color'), default: HexColor.optional() }),
  z.object({ ...field, type: z.literal('checkbox'), default: z.boolean().optional() }),
  z.object({
    ...field,
    type: z.literal('range'),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().default(1),
    unit: z.string().max(10).optional(),
    default: z.number().optional(),
  }),
  z.object({
    ...field,
    type: z.literal('select'),
    options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
    default: z.string().optional(),
  }),
  /** A collection handle, picked from the shop's collections */
  z.object({ ...field, type: z.literal('collection'), default: z.string().optional() }),
  /**
   * Raw HTML or CSS the theme outputs as is (custom code sections, extra <head> tags, custom CSS).
   * Whoever edits it can run scripts on the storefront: themes should only offer it where that's intended.
   */
  z.object({ ...field, type: z.literal('code'), language: z.enum(['html', 'css']), default: z.string().optional() }),
])

/** A kind of block: a repeatable item inside a section (a slide, an announcement, a link), as in Shopify */
export const ThemeBlockDefinition = z
  .object({
    name: z.string().min(1).max(100),
    settings: z.array(ThemeSettingField).default([]),
    /** How many blocks of this type one section can hold */
    limit: z.number().int().min(1).optional(),
    /**
     * The section's old numbered settings this block type replaces, by this type's setting id: `{n}` is the position, so
     * `{ "image": "image_{n}" }` reads image_1, image_2… A section that has no blocks yet but has such settings becomes one
     * block per position when a document is resolved (`resolveDocument`), and the old settings are dropped, so a document
     * saved before the section had blocks keeps its content.
     */
    from_settings: z.record(Id, z.string().max(64)).optional(),
    /**
     * A section's old text setting with one item per line (a brand strip's `names`) that this block type replaces: each
     * non-blank line becomes a block with the line as its `into` setting, and the old setting is dropped (see `from_settings`).
     */
    from_lines: z.object({ setting: Id, into: Id }).optional(),
  })
  .superRefine((block, ctx) => {
    if (block.from_lines && !block.settings.some((f) => f.id === block.from_lines!.into))
      ctx.addIssue({
        code: 'custom',
        message: `from_lines: "${block.from_lines.into}" is not a setting of this block type`,
      })
    for (const [id, pattern] of Object.entries(block.from_settings ?? {})) {
      if (!block.settings.some((f) => f.id === id))
        ctx.addIssue({ code: 'custom', message: `from_settings: "${id}" is not a setting of this block type` })
      if (!pattern.includes('{n}') || !Id.safeParse(pattern.replaceAll('{n}', '1')).success)
        ctx.addIssue({ code: 'custom', message: `from_settings: "${pattern}" must be a setting id with {n} in it` })
    }
  })

/**
 * The page whose sections are the theme's global ones (`{% section 'announcement-bar' %}`): the same on every page. The
 * theme editor lists them as a group at the top of each page's sections, not as a page of their own.
 */
export const THEME_STATIC_PAGE = 'static'

/** The most blocks one section holds, whatever its definition says */
export const MAX_SECTION_BLOCKS = 50

export const ThemeSectionDefinition = z.object({
  name: z.string().min(1).max(100),
  settings: z.array(ThemeSettingField).default([]),
  /** How many times the section can appear on one page */
  limit: z.number().int().min(1).optional(),
  /** For a global section (on the page `static`): which group of the editor's list it is in; default `header` */
  group: z.enum(['header', 'footer']).optional(),
  /** The block types the merchant can add to this section; none: the section has no blocks */
  blocks: z.record(Id, ThemeBlockDefinition).default({}),
  /** How many blocks (of any type) the section can hold; Shopify's `max_blocks` */
  max_blocks: z.number().int().min(1).max(MAX_SECTION_BLOCKS).optional(),
})

// ── document (the merchant's choices, stored by ShopNex) ──────────────────────

export const ThemeSettingValue = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()])
export const ThemeSettings = z.record(Id, ThemeSettingValue)

export const ThemeBlock = z.object({
  /** Stable within the section (the editor generates it) */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** A key of the section definition's `blocks` */
  type: Id,
  /** Hidden on the storefront but kept with its settings */
  disabled: z.boolean().optional(),
  settings: ThemeSettings,
})

export const ThemeSection = z.object({
  /** Stable within the page (the editor generates it); lets the preview scroll to the section */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** A key of the definition's `sections` */
  type: Id,
  /** Hidden on the storefront but kept with its settings */
  disabled: z.boolean().optional(),
  settings: ThemeSettings,
  /** In the merchant's order. Absent: none (a section whose definition has no block types). */
  blocks: z.array(ThemeBlock).max(MAX_SECTION_BLOCKS).optional(),
})

export const ThemePage = z.object({ sections: z.array(ThemeSection).max(50) })

export const ThemeDocument = z.object({
  /**
   * Which generation of the theme's structure the document is written for (the theme's `document_version` when it was
   * resolved and saved). Absent: the oldest, 1. See `resolveDocument`.
   */
  version: z.number().int().min(1).optional(),
  /** The style (a key of the definition's `presets`) the merchant last applied; absent: the theme's defaults */
  preset: Id.optional(),
  settings: ThemeSettings,
  /** Keyed by page id, e.g. "home" */
  pages: z.record(Id, ThemePage).refine((pages) => Object.keys(pages).length <= 50, 'Too many pages'),
})

/**
 * A style: ready-made theme settings (colors, fonts…), and optionally pages. Applying one changes only the settings the
 * theme's styles set; the merchant's others (logo, announcement, social links, custom code…) are kept, and so are
 * their sections on pages the preset doesn't define (see `applyPreset`).
 */
export const ThemePreset = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(200).optional(),
  /** Theme setting values; fields left out take their default */
  settings: ThemeSettings.default({}),
  /** Replaces these pages' sections when the style is applied */
  pages: z.record(Id, ThemePage).optional(),
})

/**
 * Which of the theme's settings brand the hosted checkout (it isn't rendered by the theme): each names a
 * setting id. Colors take `color` settings, fonts `select` ones (the option value is a Google Fonts family,
 * or "System"/"system"), `logo` an `image` one. Left out, checkout keeps ShopNex's own look for that part.
 */
export const ThemeCheckoutBranding = z.object({
  background: Id.optional(),
  text: Id.optional(),
  /** Buttons and links */
  accent: Id.optional(),
  headingFont: Id.optional(),
  bodyFont: Id.optional(),
  logo: Id.optional(),
})

export const ThemeDefinition = z.object({
  /** Documents are stored per theme id: keep it stable across versions */
  id: Id,
  name: z.string().min(1).max(100),
  version: z.string().max(50).optional(),
  /**
   * The generation of the theme's structure, for the merchant's saved documents. Raise it by one whenever you add a
   * `from_settings` or `from_lines`: a document saved at a lower number is migrated by them when it is read, and stamped
   * with this number, so the migration never runs on it again (and what a merchant deleted after it stays deleted).
   * A document saved at this number or higher is not migrated. The theme's structure check fails when a migration is
   * added without raising this.
   */
  document_version: z.number().int().min(1).max(1000).default(1),
  /** A picture of the theme for the admin's theme list: a path on the storefront (a theme's assets/screenshot.jpg is picked up on its own) */
  screenshot: z
    .string()
    .regex(/^\/[^?#]*$/, 'A path like /shopnex/assets/acme/screenshot.jpg')
    .optional(),
  settings: z.array(ThemeSettingField).default([]),
  sections: z.record(Id, ThemeSectionDefinition),
  pages: z.record(
    Id,
    z.object({
      name: z.string().min(1).max(100),
      /** Where the editor's preview shows this page (e.g. "/collections/all"); "/" for "home" when left out */
      path: z
        .string()
        .regex(/^\/[^?#]*$/, 'A path like /collections/all')
        .optional(),
      sections: z.array(ThemeSection),
    }),
  ),
  /**
   * Settings, sections and blocks the theme dropped on purpose, as paths (`sections/hero/settings/old_id`; a path covers
   * what is under it). A removal that is not listed here or covered by `from_settings` / `from_lines` fails the theme's
   * structure check (`unaccountedRemovals`), so a change that would orphan what merchants saved can't go unnoticed.
   */
  removed: z.array(z.string().max(200)).default([]),
  /** Styles the merchant can start from, in display order. The theme's own defaults are always offered too. */
  presets: z.record(Id, ThemePreset).default({}),
  /** How the hosted checkout picks up the theme's look; without it checkout isn't themed */
  checkout: ThemeCheckoutBranding.optional(),
})

/** What a storefront with several themes serves at THEME_DEFINITION_PATH. The first one is its default. */
export const ThemeManifest = z.object({
  themes: z
    .array(ThemeDefinition)
    .min(1)
    .refine((themes) => new Set(themes.map((t) => t.id)).size === themes.length, 'Theme ids must be unique'),
})

/** The storefront's themes from what it serves at THEME_DEFINITION_PATH (a manifest or a single definition) */
export function parseThemeManifest(json: unknown) {
  const single = ThemeDefinition.safeParse(json)
  if (single.success) return { success: true as const, themes: [single.data] }
  const manifest = ThemeManifest.safeParse(json)
  if (manifest.success) return { success: true as const, themes: manifest.data.themes }
  return { success: false as const, error: manifest.error }
}

// ── code (Online store → Themes → Edit code) ──────────────────────────────────
// A Liquid theme's templates can be edited from the admin. ShopNex stores the edited files per copy and
// storefronts render them instead of their own (`storefront.theme.files`). To show the originals, the
// admin reads them from the storefront: THEME_SOURCE_PATH with a preview token for a copy of that theme.

/** Where a Liquid storefront serves a theme's original files ({id}: the theme id), as a ThemeSource */
export const THEME_SOURCE_PATH = '/shopnex/themes/{id}/source.json'
export const themeSourcePath = (themeId: string) => THEME_SOURCE_PATH.replace('{id}', encodeURIComponent(themeId))

/** The folders a merchant can edit; files are `{folder}/{name}.liquid` */
export const THEME_CODE_FOLDERS = ['layout', 'templates', 'sections', 'snippets'] as const
export const ThemeFilePath = z
  .string()
  .regex(/^(layout|templates|sections|snippets)\/[a-z0-9][a-z0-9_-]{0,63}\.liquid$/, 'Like snippets/my-snippet.liquid')
/** Large enough for any template; a theme with more is doing something else */
export const MAX_THEME_FILE_BYTES = 256 * 1024
export const MAX_THEME_FILES = 200

/** A theme's own Liquid files by path */
export const ThemeSource = z.object({ files: z.record(ThemeFilePath, z.string()) })

export type ThemeSettingField = z.infer<typeof ThemeSettingField>
export type ThemeSettingFieldInput = z.input<typeof ThemeSettingField>
export type ThemeBlockDefinition = z.infer<typeof ThemeBlockDefinition>
export type ThemeSectionDefinition = z.infer<typeof ThemeSectionDefinition>
export type ThemePreset = z.infer<typeof ThemePreset>
export type ThemeCheckoutBranding = z.infer<typeof ThemeCheckoutBranding>
export type ThemeDefinition = z.infer<typeof ThemeDefinition>
/** What theme authors write (defaults not yet applied) */
export type ThemeDefinitionInput = z.input<typeof ThemeDefinition>
export type ThemeManifest = z.infer<typeof ThemeManifest>
export type ThemeSource = z.infer<typeof ThemeSource>
export type ThemeSettingValue = z.infer<typeof ThemeSettingValue>
export type ThemeSettings = z.infer<typeof ThemeSettings>
export type ThemeSection = z.infer<typeof ThemeSection>
export type ThemeBlock = z.infer<typeof ThemeBlock>
export type ThemePage = z.infer<typeof ThemePage>
export type ThemeDocument = z.infer<typeof ThemeDocument>

// ── helpers for themes and the editor ─────────────────────────────────────────

function valid(f: ThemeSettingField, v: unknown): boolean {
  switch (f.type) {
    case 'checkbox':
      return typeof v === 'boolean'
    case 'range':
      return typeof v === 'number' && v >= f.min && v <= f.max
    case 'select':
      return f.options.some((o) => o.value === v)
    case 'color':
      return typeof v === 'string' && HexColor.safeParse(v).success
    default:
      return typeof v === 'string'
  }
}

const fallback = (f: ThemeSettingField): ThemeSettingValue =>
  f.default ??
  (f.type === 'checkbox' ? false : f.type === 'range' ? f.min : f.type === 'select' ? f.options[0]!.value : '')

/** Every field's value: the stored one when valid for the field, else its default. Unknown keys are dropped. */
export function resolveSettings(fields: readonly ThemeSettingField[], values: ThemeSettings = {}): ThemeSettings {
  return Object.fromEntries(fields.map((f) => [f.id, valid(f, values[f.id]) ? values[f.id]! : fallback(f)]))
}

/**
 * A section's blocks as a theme should render them: in order, each with every setting resolved. Blocks of a type
 * the section no longer has are skipped, as are those past the section's `max_blocks` or a type's `limit`, so a
 * document written for an older or different theme version still renders. Hidden blocks are kept (`disabled`):
 * the editor lists them, the storefront leaves them out.
 */
export function resolveBlocks(section: ThemeSectionDefinition, blocks: readonly ThemeBlock[] = []): ThemeBlock[] {
  const perType = new Map<string, number>()
  const resolved: ThemeBlock[] = []
  for (const block of blocks) {
    const type = section.blocks[block.type]
    if (!type || resolved.length >= (section.max_blocks ?? MAX_SECTION_BLOCKS)) continue
    const count = (perType.get(block.type) ?? 0) + 1
    if (type.limit !== undefined && count > type.limit) continue
    perType.set(block.type, count)
    resolved.push({ ...block, settings: resolveSettings(type.settings, block.settings) })
  }
  return resolved
}

/**
 * The theme's global sections ({% section %}: the announcement bar, the footer…) as a document should hold them. The
 * theme owns which exist, so the merchant's saved list is kept as it is (order, settings, blocks, hidden), and every
 * section the theme's static page lists that it lacks is added with the theme's defaults, right after the nearest
 * section before it in the theme's list. A document saved before the theme had a global section (a footer that became
 * editable later) has none of it, and the editor and the storefront must agree that it is there.
 *
 * A section the merchant has counts as the theme's by id, else by type (as `{% section 'footer' %}` finds it), so a
 * second one the merchant added never makes a duplicate. Nothing the merchant saved is changed or dropped, and
 * resolving the result again changes nothing. `stored` undefined: the merchant never saved any, so the theme's own.
 */
export function resolveGlobalSections(definition: ThemeDefinition, stored?: readonly ThemeSection[]): ThemeSection[] {
  const themeSections = definition.pages[THEME_STATIC_PAGE]?.sections ?? []
  const result = [...(stored ?? themeSections)]
  if (!stored) return result
  let insertAt = 0
  for (const base of themeSections) {
    const has = result.findIndex((s) => s.id === base.id)
    const found = has !== -1 ? has : result.findIndex((s) => s.type === base.type)
    if (found !== -1) {
      insertAt = found + 1
      continue
    }
    result.splice(insertAt, 0, base)
    insertAt++
  }
  return result
}

const isFilled = (value: unknown) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')

/**
 * A section saved before it had blocks, with its content in numbered settings (image_1, heading_1…), as blocks: one per
 * position that has something, from the block types' `from_settings` (and a one-per-line text setting from `from_lines`),
 * and the old settings gone. A section that
 * has a list of blocks (even an empty one: the merchant emptied it), or has nothing in those settings, is returned as
 * it is, so this runs on every load and the second time changes nothing.
 */
export function blocksFromSettings(
  definition: ThemeSectionDefinition | undefined,
  section: ThemeSection,
): ThemeSection {
  // A list of blocks, even an empty one, is the merchant's: it was saved after blocks, and what they deleted stays deleted
  if (!definition || section.blocks !== undefined) return section
  const max = definition.max_blocks ?? MAX_SECTION_BLOCKS
  const blocks: ThemeBlock[] = []
  const used = new Set<string>()
  for (const [type, block] of Object.entries(definition.blocks)) {
    const from = block.from_settings
    const room = Math.min(block.limit ?? max, max)
    let count = 0
    const lines = block.from_lines
    const raw = lines ? section.settings[lines.setting] : undefined
    if (lines && typeof raw === 'string') {
      const items = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (items.length > 0) used.add(lines.setting)
      for (const [i, item] of items.entries()) {
        if (count >= room || blocks.length >= max) break
        blocks.push({ id: `${type}-${i + 1}`, type, settings: { [lines.into]: item } })
        count++
      }
    }
    if (!from) continue
    for (let n = 1; n <= max && count < room && blocks.length < max; n++) {
      const key = (pattern: string) => pattern.replaceAll('{n}', String(n))
      const settings = Object.fromEntries(
        Object.entries(from)
          .map(([id, pattern]) => [id, section.settings[key(pattern)]] as const)
          .filter(([, value]) => isFilled(value)),
      )
      if (Object.keys(settings).length === 0) continue
      for (const pattern of Object.values(from)) used.add(key(pattern))
      blocks.push({ id: `${type}-${n}`, type, settings: settings as ThemeSettings })
      count++
    }
  }
  if (blocks.length === 0) return section
  const rest = Object.fromEntries(Object.entries(section.settings).filter(([key]) => !used.has(key)))
  return { ...section, settings: rest, blocks }
}

/**
 * A stored document as the theme means it today. Used by whatever reads a document, so the storefront and the editor
 * see the same sections:
 * - a document saved for an older generation of the theme (`version` below the theme's `document_version`, absent
 *   meaning 1) is migrated: a section saved before it had blocks gets them from its old settings (`blocksFromSettings`),
 *   and the result is stamped with the theme's version, so it is migrated once and what the merchant deletes after that
 *   stays deleted;
 * - what the theme owns (its global sections) is always complete (`resolveGlobalSections`).
 * It keeps everything else the merchant saved; settings and a page the merchant never edited are filled from the theme's
 * defaults where they are read (`resolveSettings`, the page's default sections). Resolving again changes nothing.
 */
export function resolveDocument(definition: ThemeDefinition, document: ThemeDocument): ThemeDocument {
  const migrate = (document.version ?? 1) < definition.document_version
  const pages = Object.fromEntries(
    Object.entries(document.pages).map(([id, page]) => {
      if (!migrate) return [id, page]
      const sections = page.sections.map((s) => blocksFromSettings(definition.sections[s.type], s))
      return [id, sections.every((s, i) => s === page.sections[i]) ? page : { ...page, sections }]
    }),
  )
  if (THEME_STATIC_PAGE in definition.pages)
    pages[THEME_STATIC_PAGE] = {
      sections: resolveGlobalSections(definition, pages[THEME_STATIC_PAGE]?.sections),
    }
  const unchanged =
    !migrate &&
    Object.keys(pages).length === Object.keys(document.pages).length &&
    Object.entries(pages).every(([id, page]) => page === document.pages[id])
  if (unchanged) return document
  return { ...document, ...(migrate && { version: definition.document_version }), pages }
}

/**
 * Everything a theme declares that a saved document can hold something under, as sorted paths: `settings/<id>`,
 * `sections/<type>`, `sections/<type>/settings/<id>`, `sections/<type>/blocks/<block>` and
 * `sections/<type>/blocks/<block>/settings/<id>`. A theme's structure check keeps the last recorded list.
 */
export function themeStructure(definition: ThemeDefinition): string[] {
  const paths = definition.settings.map((f) => `settings/${f.id}`)
  for (const [type, section] of Object.entries(definition.sections)) {
    paths.push(`sections/${type}`, ...section.settings.map((f) => `sections/${type}/settings/${f.id}`))
    for (const [name, block] of Object.entries(section.blocks)) {
      paths.push(
        `sections/${type}/blocks/${name}`,
        ...block.settings.map((f) => `sections/${type}/blocks/${name}/settings/${f.id}`),
      )
    }
  }
  return paths.sort()
}

/**
 * The block types that migrate old documents (they declare `from_settings` or `from_lines`), as paths like
 * `sections/hero/blocks/slide`. A theme's structure check records them next to its `document_version`: a migration added
 * without raising the version would never run on documents already saved at the current one.
 */
export function themeMigrations(definition: ThemeDefinition): string[] {
  return Object.entries(definition.sections)
    .flatMap(([type, section]) =>
      Object.entries(section.blocks)
        .filter(([, block]) => block.from_settings || block.from_lines)
        .map(([name]) => `sections/${type}/blocks/${name}`),
    )
    .sort()
}

/**
 * What a theme used to declare (`previous`, from `themeStructure`) and no longer does, and nothing accounts for: a
 * merchant may have content saved there, which would silently stop showing. A removal is accounted for when the theme lists it
 * (or a path above it) in `removed`, or when it is a numbered setting `from_settings` reads, or the text setting `from_lines`
 * reads, which turn it into blocks. Additions are always fine.
 */
export function unaccountedRemovals(previous: readonly string[], definition: ThemeDefinition): string[] {
  const now = new Set(themeStructure(definition))
  const listed = (path: string) => definition.removed.some((r) => path === r || path.startsWith(`${r}/`))
  const migrated = (path: string) => {
    const match = /^sections\/([^/]+)\/settings\/([^/]+)$/.exec(path)
    if (!match) return false
    const [, type, id] = match
    return Object.values(definition.sections[type!]?.blocks ?? {}).some(
      (block) =>
        block.from_lines?.setting === id ||
        // A pattern is a setting id (letters, digits, - and _) with {n} in it, so {n} is all that needs turning into a regex
        Object.values(block.from_settings ?? {}).some((pattern) =>
          new RegExp(`^${pattern.replaceAll('{n}', '\\d+')}$`).test(id!),
        ),
    )
  }
  return previous.filter((path) => !now.has(path) && !listed(path) && !migrated(path)).sort()
}

/** The document a shop starts from: default settings and each page's default sections */
export function defaultDocument(definition: ThemeDefinition): ThemeDocument {
  return {
    ...(definition.document_version > 1 && { version: definition.document_version }),
    settings: resolveSettings(definition.settings),
    pages: Object.fromEntries(Object.entries(definition.pages).map(([id, page]) => [id, { sections: page.sections }])),
  }
}

/**
 * The document with a style applied (a key of `presets`, or null for the theme's own look). Only the settings that
 * styles set (any style's `settings`, e.g. colors and fonts) change: they come from the style, or are the theme's defaults
 * where this style leaves one out, so nothing of the previous style stays behind. Every other setting, the merchant's
 * logo, announcement, links and custom code, is kept. Pages the style defines get its sections; the others keep the
 * merchant's.
 */
export function applyPreset(
  definition: ThemeDefinition,
  document: ThemeDocument,
  presetId: string | null,
): ThemeDocument {
  const preset = presetId === null ? undefined : definition.presets[presetId]
  if (presetId !== null && !preset) throw new Error(`Unknown preset: ${presetId}`)
  const styled = new Set(Object.values(definition.presets).flatMap((p) => Object.keys(p.settings)))
  const kept = Object.fromEntries(Object.entries(document.settings).filter(([id]) => !styled.has(id)))
  const { preset: _, ...rest } = document
  return {
    ...rest,
    ...(presetId === null ? {} : { preset: presetId }),
    settings: resolveSettings(definition.settings, { ...preset?.settings, ...kept }),
    pages: { ...document.pages, ...preset?.pages },
  }
}

/**
 * A document from someone else (a marketplace theme style) made safe to add: only settings the definition
 * knows, minus `code` ones (custom CSS/HTML runs on the storefront), and only sections it knows, except
 * code-only ones (a Custom HTML section would show its placeholder). What's left still goes through
 * `resolveSettings` when rendered.
 */
export function withoutCodeSettings(definition: ThemeDefinition, document: ThemeDocument): ThemeDocument {
  const keep = (fields: readonly ThemeSettingField[], values: ThemeSettings) =>
    Object.fromEntries(
      fields.filter((f) => f.type !== 'code' && f.id in values).map((f) => [f.id, values[f.id]!] as const),
    )
  const preset = document.preset && document.preset in definition.presets ? document.preset : undefined
  return {
    ...(preset && { preset }),
    settings: keep(definition.settings, document.settings),
    pages: Object.fromEntries(
      Object.entries(document.pages).map(([id, page]) => [
        id,
        {
          sections: page.sections.flatMap((s) => {
            const section = definition.sections[s.type]
            const codeOnly = section?.settings.length && section.settings.every((f) => f.type === 'code')
            if (!section || codeOnly) return []
            const { blocks, ...rest } = s
            const kept = blocks?.flatMap((b) => {
              const type = section.blocks[b.type]
              return type ? [{ ...b, settings: keep(type.settings, b.settings) }] : []
            })
            return [{ ...rest, settings: keep(section.settings, s.settings), ...(kept && { blocks: kept }) }]
          }),
        },
      ]),
    ),
  }
}
