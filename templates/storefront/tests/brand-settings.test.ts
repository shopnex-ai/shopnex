// The merchant's own details (logo, social links, favicon) must show in whichever bundled theme they pick, so every bundled theme
// has the same brand settings and really uses them. A theme that hardcodes its icon would show the theme's icon in the browser tab
// of a customized or imported shop. Reads the theme files only.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, test } from 'node:test'

const dir = new URL('../themes/', import.meta.url)
const themes: string[] = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).themes
const settingsOf = (theme: string): { id?: string; type?: string }[] =>
  JSON.parse(readFileSync(new URL(`${theme}/theme.json`, dir), 'utf8')).settings
const layoutOf = (theme: string) => readFileSync(new URL(`${theme}/layout/theme.liquid`, dir), 'utf8')

/** Every Liquid file of a theme's layout and snippets: where its header, footer and icons are */
function chromeOf(theme: string) {
  const files = ['layout', 'snippets'].flatMap((folder) =>
    readdirSync(new URL(`${theme}/${folder}/`, dir)).map((file) => new URL(`${theme}/${folder}/${file}`, dir)),
  )
  return files
    .filter((file) => statSync(file).isFile() && file.pathname.endsWith('.liquid'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
}

const NETWORKS = ['instagram', 'facebook', 'x', 'tiktok', 'youtube', 'pinterest']

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

describe('the logo of every bundled theme', () => {
  for (const theme of themes) {
    test(`${theme}: has a logo and a logo width, and the header shows the logo instead of the shop name`, () => {
      const settings = settingsOf(theme)
      assert.equal(settings.find((s) => s.id === 'logo')?.type, 'image')
      assert.equal(settings.find((s) => s.id === 'logo_width')?.type, 'range')
      const chrome = chromeOf(theme)
      assert.match(chrome, /settings\.logo != blank/)
      assert.match(chrome, /settings\.logo_width/)
    })
  }
})

describe('the social links of every bundled theme', () => {
  for (const theme of themes) {
    test(`${theme}: one url setting for each network, each shown in the footer when set`, () => {
      const settings = settingsOf(theme)
      const chrome = chromeOf(theme)
      for (const network of NETWORKS) {
        assert.equal(settings.find((s) => s.id === `${network}_url`)?.type, 'url', `${network}_url`)
        assert.match(chrome, new RegExp(`settings\\.${network}_url != blank`), `${network} is not shown`)
      }
    })
  }
})
