// What a new shop shows before the merchant edits anything. A bundled theme must not ship text that reads as the shop's own claim:
// a discount, a shipping threshold, a delivery or return policy, shop statistics, or quotes from customers who do not exist.
// A merchant who does not read every default would put those promises on the live storefront. Reads theme.json only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const dir = new URL('../themes/', import.meta.url)
const themes: string[] = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).themes

type Setting = { id?: string; type?: string; default?: unknown }

/** Every setting definition in the file (theme settings, and the settings and blocks of each section), with where it is */
function settingsIn(node: unknown, path = ''): { path: string; setting: Setting }[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => {
      const own =
        item && typeof item === 'object' && 'id' in item && 'type' in item
          ? [{ path: `${path}[${i}]`, setting: item as Setting }]
          : []
      return [...own, ...settingsIn(item, `${path}[${i}]`)]
    })
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => settingsIn(value, path ? `${path}.${key}` : key))
  }
  return []
}

const TEXT_TYPES = new Set(['text', 'textarea', 'richtext', 'html'])
// A number with %, a price, a shipping or return promise, a count of customers or products, a limited offer
const CLAIM =
  /\d\s*%|[$€£]\s*\d|\bfree (shipping|delivery|returns?)\b|\blimited time\b|\bmoney.?back\b|\bguarantee|\bwithin \d+ days\b|\b\d+\s*[–-]\s*\d+\s*(business )?days\b|\b\d[\d,]*\+|\bhappy customers\b|\bbest.?selling\b|\bdeal of the\b/i
// The names and words of made-up customers
const MADE_UP_PERSON = /^(quote|author|name)_\d+$/

for (const theme of themes) {
  describe(`${theme}: the defaults a new shop shows`, () => {
    const all = settingsIn(JSON.parse(readFileSync(new URL(`${theme}/theme.json`, dir), 'utf8')))

    test('no text default is a discount, a policy, a statistic or a promise', () => {
      const claims = all
        .filter(
          ({ setting }) =>
            TEXT_TYPES.has(setting.type ?? '') && typeof setting.default === 'string' && CLAIM.test(setting.default),
        )
        .map(({ path, setting }) => `${path} (${setting.id}): ${String(setting.default)}`)
      assert.deepEqual(claims, [])
    })

    test('no quote or name of a customer is made up', () => {
      const people = all
        .filter(
          ({ setting }) =>
            MADE_UP_PERSON.test(setting.id ?? '') && typeof setting.default === 'string' && setting.default !== '',
        )
        .map(({ path, setting }) => `${path} (${setting.id}): ${String(setting.default)}`)
      assert.deepEqual(people, [])
    })
  })
}
