// The merchant's own details (here: the favicon) must show in whichever bundled theme they pick. A theme that hardcodes its icon
// would show the theme's icon in the browser tab of a customized or imported shop. Reads the theme files only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const dir = new URL('../themes/', import.meta.url)
const themes: string[] = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).themes
const settingsOf = (theme: string): { id?: string; type?: string }[] =>
  JSON.parse(readFileSync(new URL(`${theme}/theme.json`, dir), 'utf8')).settings
const layoutOf = (theme: string) => readFileSync(new URL(`${theme}/layout/theme.liquid`, dir), 'utf8')

describe('the favicon of every bundled theme', () => {
  for (const theme of themes) {
    test(`${theme}: has an image setting named favicon`, () => {
      const setting = settingsOf(theme).find((s) => s.id === 'favicon')
      assert.equal(setting?.type, 'image')
    })

    test(`${theme}: the layout uses it when set, and keeps its own icon as the fallback`, () => {
      const layout = layoutOf(theme)
      const icons = layout.match(/<link rel="icon"[^>]*>/g) ?? []
      assert.equal(icons.length, 2, 'the merchant icon and the theme icon, nothing else')
      const [mine, own] = icons as [string, string]
      assert.match(layout, /\{%-?\s*if settings\.favicon != blank\s*-?%\}/)
      assert.ok(mine.includes('{{ settings.favicon }}'), 'the merchant icon comes from the setting')
      // The merchant's icon may be a .png, .ico or .svg: no type attribute, so the browser reads the real one
      assert.ok(!/type=/.test(mine), 'no type on the merchant icon')
      assert.match(own, /asset_url/)
    })
  }
})
