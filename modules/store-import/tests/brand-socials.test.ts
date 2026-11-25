// A profile link keeps its query string: Facebook pages without a vanity name are profile.php?id=...
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Fetcher } from '../src/fetcher'
import { readBrand } from '../src/brand'

test('social links keep the query string of a profile link and skip share links', async () => {
  const html = `<html><head><title>Shop</title></head><body><footer>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="https://www.facebook.com/profile.php?id=61582532124379">f</a>
    <a href="https://www.youtube.com/@JonabStore">y</a></footer></body></html>`
  const fetcher = { text: async (url: string) => (url.endsWith('/') ? html : '') } as unknown as Fetcher
  const { socials } = await readBrand('https://example.com', fetcher)
  assert.equal(socials.facebook, 'https://www.facebook.com/profile.php?id=61582532124379')
  assert.equal(socials.youtube, 'https://www.youtube.com/@JonabStore')
})
