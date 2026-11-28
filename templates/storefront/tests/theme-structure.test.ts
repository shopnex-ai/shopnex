// A merchant's saved theme is stored under the ids a theme declares: its settings, its sections, their block types and
// those blocks' settings. Drop or rename one and what merchants saved there silently stops showing (that is how a saved
// theme lost its hero slides). This keeps the last recorded structure of each theme in tests/structure/ and fails when
// the theme has lost something that nothing accounts for:
//
// - it was moved into blocks: declare it on the block type with `from_settings` (numbered settings) or `from_lines`;
// - it was dropped on purpose: list its path in the theme's `removed` (`sections/hero/settings/old_id`).
//
// Additions are fine, but are recorded too, so a later removal is caught. To record after a change (it refuses while
// a removal is unaccounted for):
//
//   UPDATE_THEME_STRUCTURE=1 pnpm --filter shopnex-storefront exec tsx --test tests/theme-structure.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ThemeDefinition, themeStructure, unaccountedRemovals } from '@shopnex/storefront-sdk/theme'

const themesDir = new URL('../themes/', import.meta.url)
const structureDir = new URL('./structure/', import.meta.url)
const themes = (JSON.parse(readFileSync(new URL('index.json', themesDir), 'utf8')) as { themes: string[] }).themes
const RECORD = 'UPDATE_THEME_STRUCTURE=1 pnpm --filter shopnex-storefront exec tsx --test tests/theme-structure.test.ts'

describe('a theme does not lose what merchants saved', () => {
  for (const id of themes) {
    test(`${id}: nothing it declared before is gone without a declaration`, () => {
      const definition = ThemeDefinition.parse(JSON.parse(readFileSync(new URL(`${id}/theme.json`, themesDir), 'utf8')))
      const current = themeStructure(definition)
      const file = new URL(`${id}.json`, structureDir)
      const recorded: string[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []

      const lost = unaccountedRemovals(recorded, definition)
      assert.deepEqual(
        lost,
        [],
        `${id} no longer declares what a saved theme may hold, and nothing says why:\n  ${lost.join('\n  ')}\n` +
          'Moved into blocks? Add `from_settings` (numbered settings) or `from_lines` (one per line) to the block type.\n' +
          'Dropped on purpose? List the path in the theme\'s "removed".',
      )

      if (process.env.UPDATE_THEME_STRUCTURE === '1') {
        mkdirSync(structureDir, { recursive: true })
        writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`)
        return
      }
      assert.ok(existsSync(file), `${id} has no recorded structure. Record it with:\n  ${RECORD}`)
      const added = current.filter((path) => !recorded.includes(path))
      assert.deepEqual(added, [], `${id} declares new things. Record them with:\n  ${RECORD}\n  ${added.join('\n  ')}`)
    })
  }

  test('every theme in the index is checked', () => {
    assert.ok(themes.length >= 5)
  })
})
