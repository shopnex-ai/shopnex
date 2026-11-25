// The header menu of a store becomes the shop's main menu: dropdowns stay, links to what was not imported are left out.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readHeaderMenu, toMenuItems } from '../src/menu'

const html = `<header><nav class="header__inline-menu"><ul>
  <li><details><summary><span>Categories</span><svg></svg></summary><ul>
    <li><a href="/collections">All collections</a></li>
    <li><a href="/collections/bagpaks">Backpack</a></li>
    <li><a href="/collections/gone">Gone</a></li></ul></details></li>
  <li><a href="/pages/contact"><span>Contact us</span></a></li>
  <li><a href="/blogs/news">News</a></li>
</ul></nav></header>`

test('reads the nested header menu and keeps only links that still point somewhere', () => {
  const nav = readHeaderMenu(html)
  assert.equal(nav.length, 3)
  assert.equal(nav[0]!.title, 'Categories')
  assert.equal(nav[0]!.items.length, 3)

  const items = toMenuItems(nav, 'https://shop.test', {
    collections: [{ id: 'c1', title: 'Backpack', slug: 'backpack' }],
    pages: [{ id: 'p1', handle: 'contact' }],
  })
  assert.deepEqual(
    items.map((i) => [i.title, i.type, i.items.map((c) => [c.title, c.type])]),
    [
      [
        'Categories',
        'catalog',
        [
          ['All collections', 'catalog'],
          ['Backpack', 'collection'],
        ],
      ],
      ['Contact us', 'page', []],
    ],
  )
})
