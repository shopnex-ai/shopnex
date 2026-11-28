// What changed in the themes' structure between two versions, for the theme compatibility check (theme-compat.ts).
//
// A merchant's saved theme is stored under the ids a theme declares (its settings, sections, block types and their
// settings). Adding one is free. Removing or renaming one leaves what merchants saved under it where nothing reads it, so
// it is a break, the way removing a response field breaks the API (.github/workflows/api-compat.yaml).
import { ThemeDefinition, themeStructure, unaccountedRemovals } from '@shopnex/storefront-sdk/theme'

/** Each theme's theme.json, parsed, by theme id */
export type ThemeFiles = Record<string, unknown>

export type Comparison = {
  /** Themes only the new version has */
  themesAdded: string[]
  /** Themes the old version had and the new one does not list: every saved theme of them is orphaned */
  themesRemoved: string[]
  /** Per theme, what the new version declares and the old one did not */
  added: Record<string, string[]>
  /** Per theme, what is gone but accounted for (the theme lists it in `removed`) */
  accounted: Record<string, string[]>
  /** Per theme, what is gone and nothing accounts for: the break */
  breaking: Record<string, string[]>
}

const parse = (id: string, which: string, json: unknown) => {
  const parsed = ThemeDefinition.safeParse(json)
  if (!parsed.success)
    throw new Error(`${which} theme.json of ${id} is not a valid theme: ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

export function compareThemes(base: ThemeFiles, head: ThemeFiles): Comparison {
  const result: Comparison = { themesAdded: [], themesRemoved: [], added: {}, accounted: {}, breaking: {} }
  for (const id of Object.keys(head)) if (!(id in base)) result.themesAdded.push(id)
  for (const id of Object.keys(base)) if (!(id in head)) result.themesRemoved.push(id)

  for (const [id, headJson] of Object.entries(head)) {
    if (!(id in base)) continue
    const before = themeStructure(parse(id, 'base', base[id]))
    const definition = parse(id, 'head', headJson)
    const now = themeStructure(definition)

    const added = now.filter((path) => !before.includes(path))
    if (added.length > 0) result.added[id] = added

    const breaking = unaccountedRemovals(before, definition)
    if (breaking.length > 0) result.breaking[id] = breaking
    const gone = before.filter((path) => !now.includes(path))
    const accounted = gone.filter((path) => !breaking.includes(path))
    if (accounted.length > 0) result.accounted[id] = accounted
  }
  return result
}

/** Whether the comparison has a break: a removed theme, or something gone that nothing accounts for */
export const isBreaking = (c: Comparison) => c.themesRemoved.length > 0 || Object.keys(c.breaking).length > 0

/** The comparison as markdown, for the job summary and the error text */
export function describe(c: Comparison): string {
  const lines: string[] = []
  const list = (title: string, items: Record<string, string[]>) => {
    for (const [id, paths] of Object.entries(items)) {
      lines.push(`**${title}: ${id}**`, ...paths.map((p) => `- \`${p}\``), '')
    }
  }
  if (c.themesRemoved.length)
    lines.push(`**Themes removed:** ${c.themesRemoved.map((id) => `\`${id}\``).join(', ')}`, '')
  if (c.themesAdded.length) lines.push(`**Themes added:** ${c.themesAdded.map((id) => `\`${id}\``).join(', ')}`, '')
  list('Breaking, nothing accounts for it', c.breaking)
  list('Removed on purpose (listed in `removed`)', c.accounted)
  list('Added', c.added)
  return lines.length ? lines.join('\n') : "No change to any theme's structure."
}
