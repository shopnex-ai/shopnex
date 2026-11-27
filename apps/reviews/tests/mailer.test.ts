import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ShopContext } from '@shopnex/app'
import { emailMailer, EmailOffError, readEmailOff, readEmailTexts, renderEmail, saveEmailTexts } from '../src/mailer'

describe('the request email', () => {
  test('names the shop and product, links to the review page, and escapes both', () => {
    const { subject, text, html } = renderEmail({
      productTitle: 'Mug <script>alert(1)</script>',
      shopName: 'Bob & Co',
      link: 'https://reviews.example.com/r/abc?x=1&y="2"',
    })
    assert.match(subject, /How was your Mug/)
    assert.match(text, /from Bob & Co/)
    assert.match(text, /https:\/\/reviews\.example\.com\/r\/abc/)
    assert.doesNotMatch(html, /<script/i, 'no script tag in any case')
    assert.match(html, /&lt;script&gt;/, 'the title is shown as text')
    assert.match(html, /Bob &amp; Co/)
    assert.match(html, /href="https:\/\/reviews\.example\.com\/r\/abc\?x=1&amp;y=&quot;2&quot;"/)
  })

  test('works without a shop name', () => {
    assert.doesNotMatch(renderEmail({ productTitle: 'Mug', shopName: null, link: 'https://x/r/1' }).text, /from /)
  })
})

describe('the shop’s own wording', () => {
  const base = { productTitle: 'Mug', shopName: 'Mugs & Co', link: 'https://r.example.com/r/t' }

  test('fills in {product} and {shop}, keeps paragraphs and line breaks, and still links to the review page', () => {
    const { subject, text, html } = renderEmail({
      ...base,
      subject: 'Tell {shop} about your {product}',
      message: 'Hi!\n\nHow is the {product}?\nWe read every review.',
    })
    assert.equal(subject, 'Tell Mugs & Co about your Mug')
    assert.equal(text, 'Hi!\n\nHow is the Mug?\nWe read every review.\n\nhttps://r.example.com/r/t\n')
    assert.match(html, /<p>Hi!<\/p><p>How is the Mug\?<br>We read every review\.<\/p>/)
    assert.match(html, /href="https:\/\/r\.example\.com\/r\/t"/)
  })

  test('escapes the shop’s text and the names it fills in', () => {
    const { html } = renderEmail({ ...base, productTitle: '<b>Mug</b>', message: '<script>x</script> {product}' })
    assert.doesNotMatch(html, /<script|<b>/i)
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt; &lt;b&gt;Mug&lt;\/b&gt;/)
  })

  test('without a shop name {shop} reads “our shop”; a blank subject or message is the standard text', () => {
    assert.equal(renderEmail({ ...base, shopName: null, subject: 'From {shop}' }).subject, 'From our shop')
    const standard = renderEmail(base)
    assert.deepEqual(renderEmail({ ...base, subject: '  ', message: '' }), standard)
    assert.deepEqual(renderEmail({ ...base, subject: null, message: null }), standard)
  })

  test('the mailer sends what the shop saved, reading it once for all its emails', async () => {
    const { shop, sent, store } = fakeShop(() => ({ sent: true }))
    await saveEmailTexts(shop, { subject: 'About your {product}', message: 'Please review it.' })
    assert.deepEqual(await readEmailTexts(shop), { subject: 'About your {product}', message: 'Please review it.' })
    const reads = { n: 0 }
    const get = shop.data.get.bind(shop.data)
    shop.data.get = (async (key: string) => (reads.n++, get(key))) as typeof shop.data.get
    const mailer = emailMailer(shop)
    await mailer(request)
    await mailer(request)
    assert.equal(sent[0]!.body.subject, 'About your Mug')
    assert.match(sent[0]!.body.text!, /^Please review it\./)
    assert.equal(store.get('email_subject'), 'About your {product}')
    // two keys read once, plus the email-off flag read after each send
    assert.equal(reads.n, 2 + 2)
  })
})

// A shop whose Admin API answers /email/send the way a test says, and whose app storage is a Map
function fakeShop(answer: () => { sent: boolean } | Error) {
  const sent: { path: string; body: Record<string, string> }[] = []
  const store = new Map<string, unknown>()
  const shop = {
    admin: {
      api: {
        post: async (path: string, init: { body: Record<string, string> }) => {
          sent.push({ path, body: init.body })
          const result = answer()
          if (result instanceof Error) throw result
          return result
        },
      },
    },
    data: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => void store.set(key, value),
    },
  } as unknown as ShopContext
  return { shop, sent, store }
}

const request = { to: 'buyer@example.com', productTitle: 'Mug', shopName: 'Mugs', link: 'https://r.example.com/r/t' }

describe('sending through the shop’s email settings', () => {
  test('one call to /email/send with the recipient, subject and both bodies', async () => {
    const { shop, sent } = fakeShop(() => ({ sent: true }))
    await emailMailer(shop)(request)
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.path, '/email/send')
    assert.equal(sent[0]!.body.to, 'buyer@example.com')
    assert.match(sent[0]!.body.subject!, /How was your Mug/)
    assert.match(sent[0]!.body.text!, /\/r\/t/)
    assert.match(sent[0]!.body.html!, /Write a review/)
    assert.equal(await readEmailOff(shop), false)
  })

  test('email off: throws EmailOffError and remembers it, until a send works', async () => {
    let on = false
    const { shop } = fakeShop(() => ({ sent: on }))
    await assert.rejects(async () => emailMailer(shop)(request), EmailOffError)
    assert.equal(await readEmailOff(shop), true)
    on = true
    await emailMailer(shop)(request)
    assert.equal(await readEmailOff(shop), false)
  })

  test('a failed call is not mistaken for "email off"', async () => {
    const { shop } = fakeShop(() => new Error('server down'))
    await assert.rejects(async () => emailMailer(shop)(request), /server down/)
    assert.equal(await readEmailOff(shop), false)
  })
})
