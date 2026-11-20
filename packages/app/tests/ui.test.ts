import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { clientScript } from '../src/client'
import { Button, Disclosure, FilterItem, Filterable, Panel } from '../src/ui'

const html = async (node: unknown) => String(await node)

describe('the browser script', () => {
  test('is valid JavaScript (it travels as a string, so nothing else would notice a typo)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sx-client-')), 'app.mjs')
    writeFileSync(file, clientScript)
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr)
  })
})

describe('Filterable and FilterItem', () => {
  const list = (defaultTab: string) =>
    Filterable({
      tabs: [
        { value: 'open', label: 'Open', count: 2, alert: true },
        { value: 'all', label: 'All', count: 3 },
      ],
      defaultTab,
      filters: [{ name: 'rating', label: 'Any rating', options: [{ value: '5', label: '5 stars' }] }],
      search: 'Search',
      noun: 'review',
      children: [],
    })

  test('render the tabs with counts, the filters and the search box', async () => {
    const out = await html(list('open'))
    assert.match(out, /data-sx-tab-button="open"[^>]*>Open<b>2<\/b>/)
    assert.match(out, /sx-tab-alert/)
    assert.match(out, /data-sx-select="rating"/)
    assert.match(out, /<option value="5">5 stars<\/option>/)
    assert.match(out, /data-sx-search/)
  })

  test('hide the other tabs before the script runs, unless it opens on everything', async () => {
    assert.match(
      await html(list('open')),
      /:not\(\[data-ready\]\) \[data-sx-item\]:not\(\[data-sx-tab="open"\]\)\{display:none\}/,
    )
    assert.doesNotMatch(await html(list('all')), /data-ready/)
  })

  test('a default tab cannot break out of the CSS', async () => {
    const out = await html(list('x"]{}body{display:none}'))
    assert.doesNotMatch(out, /x"\]\{\}body/)
  })

  test('an item carries its tab, its filter values and its lower-cased search text', async () => {
    const out = await html(FilterItem({ tab: 'open', values: { rating: 5 }, text: 'Great MUG', children: 'x' }))
    assert.match(out, /data-sx-tab="open"/)
    assert.match(out, /data-sx-f-rating="5"/)
    assert.match(out, /data-sx-text="great mug"/)
  })
})

describe('Disclosure, Panel and Button toggles', () => {
  test('a disclosure shows its summary and can start open', async () => {
    const out = await html(Disclosure({ title: 'Publishing', summary: 'by hand', open: true, children: 'x' }))
    assert.match(out, /<details class="sx-disclosure" open/)
    assert.match(out, /Publishing<span>by hand<\/span>/)
  })

  test('a panel starts hidden and a toggle button points at it', async () => {
    assert.match(await html(Panel({ id: 'p1', children: 'x' })), /id="p1"[^>]*data-sx-panel[^>]*hidden/)
    assert.match(await html(Panel({ id: 'p1', open: true, children: 'x' })), /^(?!.*hidden)/)
    const button = await html(Button({ toggles: 'p1', children: 'Reply' }))
    assert.match(button, /type="button"/)
    assert.match(button, /data-sx-toggle="p1"/)
    assert.doesNotMatch(button, /data-shopnex-action/)
  })

  test('a button can ask for a second click', async () => {
    const out = await html(Button({ action: '/x', confirm: 'Click again', children: 'Delete' }))
    assert.match(out, /data-confirm="Click again"/)
  })
})
