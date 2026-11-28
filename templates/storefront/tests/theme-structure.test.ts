// A merchant's saved theme is stored under the ids a theme declares: its settings, its sections, their block types and
// those blocks' settings. Drop or rename one and what merchants saved there silently stops showing (that is how a saved
// theme lost its hero slides). This keeps the last recorded structure of each theme in tests/structure/ and fails when
// the theme has lost something that nothing accounts for:
//
// - it was moved into blocks: declare it on the block type with `from_settings` (numbered settings) or `from_lines`;
// - it was dropped on purpose: list its path in the theme's `removed` (`sections/hero/settings/old_id`).
//
// A migration (`from_settings` / `from_lines`) only runs on documents saved at a lower `document_version` than the theme's,
// so adding one without raising `document_version` would never reach the documents already saved: that fails too.
//
// Additions are fine, but are recorded too, so a later removal is caught. To record after a change (it refuses while
// a removal is unaccounted for):
//
//   UPDATE_THEME_STRUCTURE=1 pnpm --filter shopnex-storefront exec tsx --test tests/theme-structure.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ThemeDefinition, themeMigrations, themeStructure, unaccountedRemovals } from '@shopnex/storefront-sdk/theme'

const themesDir = new URL('../themes/', import.meta.url)
const structureDir = new URL('./structure/', import.meta.url)
const themes = (JSON.parse(readFileSync(new URL('index.json', themesDir), 'utf8')) as { themes: string[] }).themes
const RECORD = 'UPDATE_THEME_STRUCTURE=1 pnpm --filter shopnex-storefront exec tsx --test tests/theme-structure.test.ts'

type Recorded = { documentVersion: number; paths: string[]; migrations: string[] }
/** The recorded file (an older one was just the list of paths) */
const read = (file: URL): Recorded => {
  if (!existsSync(file)) return { documentVersion: 1, paths: [], migrations: [] }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Recorded | string[]
  return Array.isArray(raw) ? { documentVersion: 1, paths: raw, migrations: [] } : raw
}

describe('a theme does not lose what merchants saved', () => {
  for (const id of themes) {
    test(`${id}: nothing it declared before is gone without a declaration`, () => {
      const definition = ThemeDefinition.parse(JSON.parse(readFileSync(new URL(`${id}/theme.json`, themesDir), 'utf8')))
      const current = {
        documentVersion: definition.document_version,
        paths: themeStructure(definition),
        migrations: themeMigrations(definition),
      }
      const file = new URL(`${id}.json`, structureDir)
      const recorded = read(file)

      const lost = unaccountedRemovals(recorded.paths, definition)
      assert.deepEqual(
        lost,
        [],
        `${id} no longer declares what a saved theme may hold, and nothing says why:\n  ${lost.join('\n  ')}\n` +
          'Moved into blocks? Add `from_settings` (numbered settings) or `from_lines` (one per line) to the block type.\n' +
          'Dropped on purpose? List the path in the theme\'s "removed".',
      )

      const newMigrations = current.migrations.filter((path) => !recorded.migrations.includes(path))
      assert.ok(
        newMigrations.length === 0 || current.documentVersion > recorded.documentVersion,
        `${id} adds a migration (${newMigrations.join(', ')}) but its document_version is still ${current.documentVersion}: ` +
          'documents already saved at that version would never be migrated. Raise "document_version" by one.',
      )
      assert.ok(
        current.documentVersion >= recorded.documentVersion,
        `${id}: document_version went down (${recorded.documentVersion} to ${current.documentVersion}).`,
      )

      if (process.env.UPDATE_THEME_STRUCTURE === '1') {
        mkdirSync(structureDir, { recursive: true })
        writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`)
        return
      }
      assert.ok(existsSync(file), `${id} has no recorded structure. Record it with:\n  ${RECORD}`)
      const added = [...current.paths, ...current.migrations].filter(
        (path) => !recorded.paths.includes(path) && !recorded.migrations.includes(path),
      )
      assert.deepEqual(added, [], `${id} declares new things. Record them with:\n  ${RECORD}\n  ${added.join('\n  ')}`)
      assert.equal(
        current.documentVersion,
        recorded.documentVersion,
        `${id}: document_version changed. Record it with:\n  ${RECORD}`,
      )
    })
  }

  test('every theme in the index is checked', () => {
    assert.ok(themes.length >= 5)
  })
})
