// An image setting the merchant uploaded in the theme editor is saved as /api/files/{key}; the page gets it where the browser reaches the API
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ThemeSettingField } from '@shopnex/storefront-sdk/theme'

process.env.SHOPNEX_PUBLIC_URL = 'https://api.example.test/'
const { settingsObject } = await import('../src/core/drops')

const fields: ThemeSettingField[] = [
  { id: 'logo', label: 'Logo', type: 'image' },
  { id: 'link', label: 'Link', type: 'url' },
]
const settings = (values: Record<string, string>) =>
  settingsObject(fields, values, {} as never) as Record<string, unknown>

describe('image settings', () => {
  test('an uploaded file path gets the API origin in front of it', () => {
    assert.equal(
      settings({ logo: '/api/files/shop1/a-1.png' }).logo,
      'https://api.example.test/api/files/shop1/a-1.png',
    )
  })
  test('another image URL, a theme asset path and an empty value stay as they are', () => {
    assert.equal(settings({ logo: 'https://cdn.example.test/a.png' }).logo, 'https://cdn.example.test/a.png')
    assert.equal(
      settings({ logo: '/shopnex/assets/ks-bootshop/hero-1.jpg' }).logo,
      '/shopnex/assets/ks-bootshop/hero-1.jpg',
    )
    assert.equal(settings({ logo: '' }).logo, '')
  })
  test('an unsafe value is still dropped', () => {
    assert.equal(settings({ logo: 'javascript:alert(1)' }).logo, '')
  })
  test('a url setting is not changed', () => {
    assert.equal(settings({ link: '/api/files/shop1/a-1.pdf' }).link, '/api/files/shop1/a-1.pdf')
  })
})
