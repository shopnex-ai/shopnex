// What a buyer typed for a line (an engraving) must be shown back to them in the cart. Every bundled theme that draws the cart's
// lines in script has to use visibleAttributes (the SDK's rule for what the buyer sees: not the shop's own `_` ones). Reads the
// theme files only.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const dir = new URL('../themes/', import.meta.url)
const themes: string[] = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).themes

/** The theme's script files that fill the cart's line list */
function cartScripts(theme: string) {
  const src = new URL(`${theme}/src/`, dir)
  return readdirSync(src)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: `${theme}/src/${f}`, code: readFileSync(new URL(f, src), 'utf8') }))
    .filter(({ code }) => code.includes('[data-cart-lines]'))
}

for (const theme of themes) {
  describe(`${theme}: the cart shows what the buyer typed`, () => {
    for (const { file, code } of cartScripts(theme)) {
      test(`${file} draws each line's visible attributes, escaped`, () => {
        assert.match(code, /visibleAttributes\(line\)/)
        assert.match(code, /esc\(a\.key\)/)
        assert.match(code, /esc\(a\.value\)/)
      })
    }
  })
}
