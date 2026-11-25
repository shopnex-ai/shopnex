// A store's announcement bar, read from its home page (Dawn's markup): messages, links, auto-rotation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAnnouncements } from '../src/announcements'

const origin = 'https://shop.example.com'
const slide = (text: string, href?: string) =>
  `<div class="announcement-bar__announcement" role="region">${
    href ? `<a href="${href}" class="announcement-bar__link link link--text focus-inset animate-arrow">` : ''
  }<p class="announcement-bar__message h5"><span>${text}</span></p>${href ? '</a>' : ''}</div>`

const bar = (slides: string[], attrs = 'data-autoplay="true" data-speed="4"') =>
  `<slideshow-component class="announcement-bar"><div class="announcement-bar-slider">
   <div class="grid slider" id="Slider-sections--1__announcement-bar" aria-live="polite" ${attrs}>${slides.join('')}</div>
   </div></slideshow-component>`

test('reads each message in order, with the page’s entities decoded', () => {
  const { messages } = readAnnouncements(bar([slide('Free &amp; fast'), slide('&quot; Hello &quot;')]), origin)
  assert.deepEqual(messages, [
    { text: 'Free & fast', link: null },
    { text: '" Hello "', link: null },
  ])
})

test('keeps a message’s link only where it still leads somewhere', () => {
  const html = bar([
    slide('Sale', 'https://other.example.org/sale'),
    slide('Shop', '/collections/all'),
    slide('Deep', '/collections/summer'),
    slide('Plain'),
  ])
  assert.deepEqual(
    readAnnouncements(html, origin).messages.map((m) => m.link),
    ['https://other.example.org/sale', '/collections/all', null, null],
  )
})

test('a link belongs to its own message, not the next one', () => {
  const { messages } = readAnnouncements(bar([slide('A', '/search'), slide('B')]), origin)
  assert.deepEqual(messages, [
    { text: 'A', link: '/search' },
    { text: 'B', link: null },
  ])
})

test('reads whether it rotates by itself and how fast, within what the theme allows', () => {
  assert.deepEqual(
    { ...readAnnouncements(bar([slide('A')], 'data-autoplay="true" data-speed="7"'), origin), messages: 0 },
    { messages: 0, autoRotate: true, seconds: 7 },
  )
  const off = readAnnouncements(bar([slide('A')], 'data-autoplay="false" data-speed="2"'), origin)
  assert.equal(off.autoRotate, false)
  assert.equal(off.seconds, 3)
  assert.equal(readAnnouncements(bar([slide('A')], 'data-autoplay="true" data-speed="30"'), origin).seconds, 10)
})

test('skips an empty message and stops at what the bar holds', () => {
  assert.deepEqual(readAnnouncements(bar([slide('  '), slide('Only')]), origin).messages, [
    { text: 'Only', link: null },
  ])
  const many = Array.from({ length: 20 }, (_, i) => slide(`M${i}`))
  assert.equal(readAnnouncements(bar(many), origin).messages.length, 12)
})

test('a page with no announcement bar has none', () => {
  assert.deepEqual(readAnnouncements('<html><body><h1>Shop</h1></body></html>', origin), {
    messages: [],
    autoRotate: false,
    seconds: null,
  })
})
