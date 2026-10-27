// Theme editor format, shared by the Shopnex admin (the editor) and themes (storefront templates).
//
//   - A theme describes what can be customized in a ThemeDefinition: global settings, section types with
//     their settings, each page's default sections, and optional styles (presets). The storefront serves
//     its themes at THEME_DEFINITION_PATH (e.g. https://shop.acme.com/shopnex/theme.json): a ThemeManifest
//     listing them, or a single ThemeDefinition for a storefront with one theme.
//   - The merchant's choices are a ThemeDocument. Shopnex stores it (a draft and a published copy);
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

const field = { id: Id, label: z.string().min(1).max(100), info: z.string().max(500).optional() }

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

export const ThemeSectionDefinition = z.object({
  name: z.string().min(1).max(100),
  settings: z.array(ThemeSettingField).default([]),
  /** How many times the section can appear on one page */
  limit: z.number().int().min(1).optional(),
})

// ── document (the merchant's choices, stored by Shopnex) ──────────────────────

export const ThemeSettingValue = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()])
export const ThemeSettings = z.record(Id, ThemeSettingValue)

export const ThemeSection = z.object({
  /** Stable within the page (the editor generates it); lets the preview scroll to the section */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** A key of the definition's `sections` */
  type: Id,
  /** Hidden on the storefront but kept with its settings */
  disabled: z.boolean().optional(),
  settings: ThemeSettings,
})

export const ThemePage = z.object({ sections: z.array(ThemeSection).max(50) })

export const ThemeDocument = z.object({
  /** The style (a key of the definition's `presets`) the merchant last applied; absent: the theme's defaults */
  preset: Id.optional(),
  settings: ThemeSettings,
  /** Keyed by page id, e.g. "home" */
  pages: z.record(Id, ThemePage).refine((pages) => Object.keys(pages).length <= 50, 'Too many pages'),
})

/**
 * A style: ready-made theme settings (colors, fonts…), and optionally pages. Applying one keeps the
 * merchant's `code` settings, and their sections on pages the preset doesn't define (see `applyPreset`).
 */
export const ThemePreset = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(200).optional(),
  /** Theme setting values; fields left out take their default */
  settings: ThemeSettings.default({}),
  /** Replaces these pages' sections when the style is applied */
  pages: z.record(Id, ThemePage).optional(),
})

export const ThemeDefinition = z.object({
  /** Documents are stored per theme id: keep it stable across versions */
  id: Id,
  name: z.string().min(1).max(100),
  version: z.string().max(50).optional(),
  settings: z.array(ThemeSettingField).default([]),
  sections: z.record(Id, ThemeSectionDefinition),
  pages: z.record(
    Id,
    z.object({
      name: z.string().min(1).max(100),
      /** Where the editor's preview shows this page (e.g. "/collections/all"); "/" for "home" when left out */
      path: z.string().regex(/^\/[^?#]*$/, 'A path like /collections/all').optional(),
      sections: z.array(ThemeSection),
    }),
  ),
  /** Styles the merchant can start from, in display order. The theme's own defaults are always offered too. */
  presets: z.record(Id, ThemePreset).default({}),
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
// A Liquid theme's templates can be edited from the admin. Shopnex stores the edited files per copy and
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
export type ThemeSectionDefinition = z.infer<typeof ThemeSectionDefinition>
export type ThemePreset = z.infer<typeof ThemePreset>
export type ThemeDefinition = z.infer<typeof ThemeDefinition>
/** What theme authors write (defaults not yet applied) */
export type ThemeDefinitionInput = z.input<typeof ThemeDefinition>
export type ThemeManifest = z.infer<typeof ThemeManifest>
export type ThemeSource = z.infer<typeof ThemeSource>
export type ThemeSettingValue = z.infer<typeof ThemeSettingValue>
export type ThemeSettings = z.infer<typeof ThemeSettings>
export type ThemeSection = z.infer<typeof ThemeSection>
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

/** The document a shop starts from: default settings and each page's default sections */
export function defaultDocument(definition: ThemeDefinition): ThemeDocument {
  return {
    settings: resolveSettings(definition.settings),
    pages: Object.fromEntries(Object.entries(definition.pages).map(([id, page]) => [id, { sections: page.sections }])),
  }
}

/**
 * The document with a style applied (a key of `presets`, or null for the theme's defaults). Theme settings
 * come from the style, except `code` ones (the merchant's own CSS/HTML), which are kept. Pages the style
 * defines get its sections; the others keep the merchant's.
 */
export function applyPreset(
  definition: ThemeDefinition,
  document: ThemeDocument,
  presetId: string | null,
): ThemeDocument {
  const preset = presetId === null ? undefined : definition.presets[presetId]
  if (presetId !== null && !preset) throw new Error(`Unknown preset: ${presetId}`)
  const kept = Object.fromEntries(
    definition.settings
      .filter((f) => f.type === 'code' && f.id in document.settings)
      .map((f) => [f.id, document.settings[f.id]!]),
  )
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
            return section && !codeOnly ? [{ ...s, settings: keep(section.settings, s.settings) }] : []
          }),
        },
      ]),
    ),
  }
}
