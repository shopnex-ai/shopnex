// What is accepted as an image comes from the first bytes, never from a name or a Content-Type.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { IMAGE_TYPES, sniffImage, typeOfKey } from '../src/sniff'

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])))
const pad = (head: Uint8Array, length = 32) => {
  const out = new Uint8Array(length)
  out.set(head)
  return out
}

describe('sniffImage', () => {
  test('recognizes each accepted type by its signature', () => {
    assert.equal(sniffImage(pad(bytes(0xff, 0xd8, 0xff, 0xe0))), 'image/jpeg')
    assert.equal(sniffImage(pad(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))), 'image/png')
    assert.equal(sniffImage(pad(bytes('GIF87a'))), 'image/gif')
    assert.equal(sniffImage(pad(bytes('GIF89a'))), 'image/gif')
    assert.equal(sniffImage(pad(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))), 'image/webp')
    assert.equal(sniffImage(pad(bytes(0, 0, 0, 0x1c, 'ftypavif'))), 'image/avif')
    assert.equal(sniffImage(pad(bytes(0, 0, 0, 0x1c, 'ftypavis'))), 'image/avif')
  })

  test('refuses what is not an accepted image, whatever it claims to be', () => {
    assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null)
    assert.equal(sniffImage(new TextEncoder().encode('<!doctype html><script>alert(1)</script>')), null)
    assert.equal(sniffImage(new TextEncoder().encode('just some text')), null)
    assert.equal(sniffImage(pad(bytes('%PDF-1.7'))), null)
  })

  test('a RIFF container that is not WebP is refused, and so is an mp4', () => {
    assert.equal(sniffImage(pad(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))), null)
    assert.equal(sniffImage(pad(bytes(0, 0, 0, 0x1c, 'ftypisom'))), null)
  })

  test('an empty or tiny buffer is refused instead of throwing', () => {
    assert.equal(sniffImage(new Uint8Array()), null)
    assert.equal(sniffImage(bytes(0xff)), null)
    assert.equal(sniffImage(bytes(0xff, 0xd8)), null)
  })

  test('SVG is not an accepted type: files are served from the admin origin', () => {
    assert.ok(!('image/svg+xml' in IMAGE_TYPES))
    assert.deepEqual(Object.values(IMAGE_TYPES).sort(), ['avif', 'gif', 'jpg', 'png', 'webp'])
  })
})

describe('typeOfKey', () => {
  test('gives the content type of a key the service generated', () => {
    assert.equal(typeOfKey('shop/0b9e.png'), 'image/png')
    assert.equal(typeOfKey('shop/0b9e.jpg'), 'image/jpeg')
    assert.equal(typeOfKey('shop/0b9e.webp'), 'image/webp')
  })

  test('is null for an extension that is not one of ours', () => {
    assert.equal(typeOfKey('shop/0b9e.svg'), null)
    assert.equal(typeOfKey('shop/0b9e.html'), null)
    assert.equal(typeOfKey('no-extension'), null)
  })
})
