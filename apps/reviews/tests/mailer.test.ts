import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ShopContext } from '@shopnex/app'
import { emailMailer, EmailOffError, readEmailOff, renderEmail } from '../src/mailer'

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
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /Bob &amp; Co/)
    assert.match(html, /href="https:\/\/reviews\.example\.com\/r\/abc\?x=1&amp;y=&quot;2&quot;"/)
  })

  test('works without a shop name', () => {
    assert.doesNotMatch(renderEmail({ productTitle: 'Mug', shopName: null, link: 'https://x/r/1' }).text, /from /)
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
