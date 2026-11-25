// The bundled themes' text (locales/): every key a theme uses exists, and the translations fit the text they translate.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { flattenMessages, type Message } from '@shopnex/storefront-sdk/i18n'

const themesDir = join(import.meta.dirname, '../themes')
const themes: string[] = JSON.parse(readFileSync(join(themesDir, 'index.json'), 'utf8')).themes

/** Every file under a folder whose name ends with one of the extensions */
function files(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return entry.name === 'node_modules' || entry.name === 'assets' ? [] : files(path, extensions)
    return extensions.some((e) => entry.name.endsWith(e)) ? [path] : []
  })
}
const read = (paths: string[]) => paths.map((p) => readFileSync(p, 'utf8')).join('\n')
const placeholders = (message: Message) =>
  [
    ...new Set(
      Object.values(typeof message === 'string' ? { other: message } : message).flatMap((m) =>
        [...(m ?? '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((x) => x[1]!),
      ),
    ),
  ].sort()
const locale = (theme: string, file: string) =>
  flattenMessages(JSON.parse(readFileSync(join(themesDir, theme, 'locales', file), 'utf8')))

for (const theme of themes) {
  describe(`${theme}'s text`, () => {
    const folder = join(themesDir, theme, 'locales')
    const english = locale(theme, 'en.default.json')
    const others = readdirSync(folder).filter((f) => f.endsWith('.json') && f !== 'en.default.json')

    test('every key the Liquid and the scripts use is in its default language', () => {
      const liquid = read(files(join(themesDir, theme), ['.liquid']))
      const scripts = read(files(join(themesDir, theme, 'src'), ['.ts', '.tsx']))
      const used = [
        ...[...liquid.matchAll(/\{\{\s*'([a-z0-9_.]+)'\s*\|\s*t\b/g)].map((m) => m[1]!),
        ...[...scripts.matchAll(/\btr?\(\s*'([a-z0-9_.]+)'/g)].map((m) => m[1]!),
      ]
      assert.ok(used.length > 20, `${theme} uses ${used.length} keys: is the text still in the templates?`)
      assert.deepEqual([...new Set(used)].filter((key) => !(key in english)).sort(), [], 'keys with no text')
    })

    test('no text in the default language goes unused', () => {
      // Core translates a few labels itself (the filters of a listing, src/core/theme.ts) with the theme's text
      const code = read([
        ...files(join(themesDir, theme), ['.liquid']),
        ...files(join(themesDir, theme, 'src'), ['.ts', '.tsx']),
        ...files(join(import.meta.dirname, '../src/core'), ['.ts']),
      ])
      assert.deepEqual(
        Object.keys(english)
          .filter((key) => !code.includes(`'${key}'`))
          .sort(),
        [],
        'unused keys',
      )
    })

    test('has translations, and each one keeps the placeholders of the text it translates and no keys of its own', () => {
      assert.ok(others.length >= 3, `${theme} has ${others.length} translations`)
      for (const file of others) {
        const translated = locale(theme, file)
        assert.deepEqual(
          Object.keys(translated).filter((key) => !(key in english)),
          [],
          `${file}: keys the default language does not have`,
        )
        for (const [key, message] of Object.entries(translated)) {
          assert.deepEqual(placeholders(message), placeholders(english[key]!), `${file}: ${key}`)
          assert.equal(
            typeof message === 'string',
            typeof english[key] === 'string',
            `${file}: ${key} is text in one language and plural forms in the other`,
          )
        }
      }
    })
  })
}
