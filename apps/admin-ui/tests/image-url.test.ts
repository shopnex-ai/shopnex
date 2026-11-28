// What the theme editor saves for an uploaded image (src/lib/image-url.ts)
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isShowableImage, storedImageUrl } from '../src/lib/image-url'

const origin = 'https://admin.example.test'

describe('storedImageUrl', () => {
  test("a file on this app's own disk is saved as its path, so a changed domain does not break it", () => {
    assert.equal(storedImageUrl(`${origin}/api/files/shop1/abc-123.png`, origin), '/api/files/shop1/abc-123.png')
  })
  test('a bucket URL, another host, or another path is saved as it is', () => {
    for (const url of [
      'https://cdn.example.test/shop1/abc.png',
      'https://other.example.test/api/files/shop1/abc.png',
      `${origin}/uploads/abc.png`,
      `${origin}/api/files/shop1/abc.png?v=2`,
      `${origin}/api/files/shop1/abc.png#top`,
    ])
      assert.equal(storedImageUrl(url, origin), url)
  })
  test('anything that is not a URL comes back unchanged', () => {
    assert.equal(storedImageUrl('/api/files/a/b.png', origin), '/api/files/a/b.png')
    assert.equal(storedImageUrl('', origin), '')
  })
})

describe('isShowableImage', () => {
  test('an absolute URL or a path on this host can be previewed; nothing else', () => {
    assert.ok(isShowableImage('https://x.test/a.png'))
    assert.ok(isShowableImage('/api/files/a/b.png'))
    assert.ok(isShowableImage('/shopnex/assets/ks-bootshop/hero-1.jpg'))
    for (const value of ['', 'photo.png', '//evil.test/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA'])
      assert.ok(!isShowableImage(value), value)
  })
})
