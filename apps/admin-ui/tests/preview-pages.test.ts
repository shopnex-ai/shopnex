// The editor's page picker: the theme's global sections are a group on every page, not a page of their own.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ThemeDefinition } from '@shopnex/storefront-sdk/theme'
import { previewPageOptions } from '../src/screens/online-store/themes/preview-pages'

const definition = ThemeDefinition.parse({
  id: 't',
  name: 'T',
  sections: { bar: { name: 'Bar' } },
  pages: {
    home: { name: 'Home', sections: [] },
    static: { name: 'Header', sections: [{ id: 'bar', type: 'bar', settings: {} }] },
  },
})

test('does not list the global sections as a page to preview', () => {
  const values = previewPageOptions(definition, { products: [], collections: [], pages: [] }).map((o) => o.value)
  assert.ok(values.includes('home'))
  assert.equal(values.includes('static'), false)
})

test('names the usual pages, uses the theme’s own name for others, and offers the missing usual ones', () => {
  const themed = ThemeDefinition.parse({
    id: 't',
    name: 'T',
    sections: {},
    pages: {
      home: { name: 'Landing', sections: [] },
      about: { name: 'About us', sections: [] },
      product: { name: 'Item', sections: [] },
    },
  })
  const options = previewPageOptions(themed, { products: [], collections: [], pages: [] })
  assert.deepEqual(options, [
    { value: 'home', label: 'Home page' },
    { value: 'about', label: 'About us' },
    { value: 'product', label: 'Product' },
    { value: 'collection', label: 'Collection' },
    { value: 'page', label: 'Content page' },
    { value: '404', label: '404 page' },
  ])
})
